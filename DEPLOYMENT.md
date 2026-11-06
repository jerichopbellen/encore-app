# Encore deployment guide

This guide prepares the existing monorepo for a manually configured deployment. It does not create provider resources or prove the app works on a hosted account.

## Architecture

- **Vercel** builds the static React/Vite frontend from `client/`.
- **Render** runs the CommonJS Express API from `server/` as a Node web service.
- **Neon** hosts PostgreSQL. The Express API uses the Neon pooled connection through the existing Prisma 7 PostgreSQL adapter. Prisma CLI migration commands use the direct connection when `DIRECT_DATABASE_URL` is configured.
- Browser calls use the Vite development proxy locally and Vercel's same-origin `/api` rewrite in production. Cookie-authenticated requests include credentials, so the browser talks to its own Vercel origin while Vercel forwards API traffic to Render. The backend responds to only the exact `FRONTEND_ORIGIN`, and a separate API guard validates Origin on unsafe requests.

The production frontend and API provider hostnames (`*.vercel.app` and `*.onrender.com`) are different sites. Direct browser requests to Render therefore depend on cross-site cookies, which browsers may block even when `SameSite=None; Secure` is configured. Encore instead sends browser requests to the Vercel origin and uses an external rewrite as a reverse proxy to Render. This makes the session cookie host-only to the frontend site and first-party in the browser. Keep `COOKIE_SAME_SITE=lax`, `Secure`, and `HttpOnly`; do not set a cookie `Domain`. A custom same-site domain or another deliberately designed proxy is also possible, but do not rely on cross-site provider-host cookies for production authentication.

## Local development

1. Copy `server/.env.example` to an ignored `server/.env` and set local `DATABASE_URL` and a random `JWT_SECRET` of at least 32 bytes. Keep `DIRECT_DATABASE_URL` blank unless you want Prisma CLI commands to use a separate direct URL.
2. From `server/`, run `npm ci`, `npx prisma generate --config prisma7.config.ts`, then `npm start`.
3. From `client/`, run `npm ci` and `npm run dev`. When `VITE_API_BASE_URL` is blank, the existing Vite proxy sends `/api` to `http://localhost:5000`.
   Copy `client/.env.example` to `client/.env.local` only if you need to override the default; keep it blank for the normal local proxy workflow.
4. Use the dedicated database setup in [tests/README.md](tests/README.md) for integration testing. Integration tests must use a database named with a distinct `test` segment; they never fall back to `DATABASE_URL`.

For a schema change, edit `server/prisma/schema.prisma`, create a migration from a disposable local development database with `npx prisma migrate dev --name <short_change_name> --config prisma7.config.ts`, review the generated SQL (including any required raw PostgreSQL constraints), and run the complete test suite. Never use `migrate dev`, `db push`, or seed commands against production.

## Vercel frontend

In the Vercel project settings, configure:

- **Root directory:** `client`
- **Framework preset:** Vite (or automatic detection)
- **Build command:** `npm run build`
- **Output directory:** `dist`
- Production builds always use relative `/api/...` requests, even if an old `VITE_API_BASE_URL` setting remains configured. Remove that Vercel variable to avoid confusion. In local development it remains an optional override; leave it blank to use Vite's local proxy.

The first rewrite in `client/vercel.json` forwards `/api/:path*` to the Render API while leaving the browser URL on the Vercel site; the later SPA rewrite returns `index.html` for client routes and excludes `/api` paths. Vercel documents external rewrites as a reverse-proxy pattern ([Vercel rewrites documentation](https://vercel.com/docs/routing/rewrites)). Production code ignores `VITE_API_BASE_URL` to ensure it cannot bypass the same-origin proxy and reintroduce cross-site cookie behavior. `VITE_` values are public and must never contain credentials or server secrets.

## Render backend

Create a **Web Service** from the existing repository. `render.yaml` describes the Node service with `server/` as its root, `npm ci && npx prisma generate --config prisma7.config.ts` as its build command, `npm start` as its start command, and `/api/ready` as the HTTP health check. Render supplies `PORT`; the server binds that port on `0.0.0.0` and uses `5000` only as the local fallback.

Set these server-only variables in the Render dashboard:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes | Set to exactly `production`; enables secure cookies and production startup checks. The IP-based rate limiters run only when it is exactly `development` or `test`, so any other value (including a typo or an unset variable) leaves them off. |
| `DATABASE_URL` | Yes | Neon pooled PostgreSQL URL for API queries, including `sslmode=require`. |
| `DIRECT_DATABASE_URL` | Yes before migration operations | Neon direct URL for Prisma CLI and schema migration commands, targeting the same database. |
| `JWT_SECRET` | Yes | Random private signing secret of at least 32 bytes; never expose it to Vercel. |
| `FRONTEND_ORIGIN` | Yes | Exact HTTPS origin of the deployed frontend; no path or trailing slash. |
| `COOKIE_SAME_SITE` | Optional | Keep `lax` for the Vercel `/api` proxy. Do not use `none` to compensate for direct cross-site provider-host requests. |
| `JWT_EXPIRES_IN` | Optional | Defaults to `1d`. |
| `PORT` | No | Supplied by Render. Do not hardcode a dashboard value. |
| `TRUST_PROXY_HOPS` | **Leave unset in production** | Number of trusted proxies in front of Express (1 to 5 in production; 0 is rejected there). In production it is ignored (the IP-based limiters stay off and startup logs a warning), because no single value is safe for the current Vercel-to-Render architecture. See [Client IP handling and IP-based limits](#client-ip-handling-and-ip-based-limits-disabled-in-production). |
| `RATE_LIMIT_*` | Optional | Per-limiter overrides of the initial limits and windows; see the same section. |
| `PAYMENT_PROVIDER` | Optional | `simulated` (default) or `stripe`. With `stripe`, the API requires Stripe-hosted Checkout in test mode and rejects simulated checkout. Not configured in `render.yaml`; deliberately left for a separate, reviewed deployment change. |
| `STRIPE_SECRET_KEY` | Only with `stripe` | Stripe **test-mode** secret key (`sk_test_...`); live keys are rejected at startup. Keep it server-side only. |
| `STRIPE_WEBHOOK_SECRET` | Only with `stripe` | Signing secret (`whsec_...`) of the Stripe webhook endpoint `POST /api/payments/stripe/webhook`. Subscribe it to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. |
| `CLOUDINARY_CLOUD_NAME` | Optional (poster uploads) | Cloudinary cloud name. Set all three Cloudinary variables together or leave all blank; a partial set fails startup. Not configured in `render.yaml`. |
| `CLOUDINARY_API_KEY` | Optional (poster uploads) | Cloudinary API key. Server-side only. |
| `CLOUDINARY_API_SECRET` | Optional (poster uploads) | Cloudinary API secret. Server-side only; never put it in Vercel or any `VITE_` variable. |
| `CLOUDINARY_POSTER_FOLDER` | Optional | Public ID prefix for poster assets; defaults to `encore/event-posters`. Also used as the Media Library folder the posters are filed in. Use a distinct folder per environment (for example `encore-staging/event-posters`). |
| `POSTER_UPLOAD_MAX_BYTES` | Optional | Maximum poster upload size in bytes, from 1024 to 10485760. Defaults to 4194304 (4 MB). |

`render.yaml` marks secrets as dashboard-managed and contains no credentials. It does not create a Neon database or run migrations during application startup. Set Render's `FRONTEND_ORIGIN` to the exact browser-visible Vercel origin (currently `https://encore-app-theta.vercel.app`) so CORS and the unsafe-request Origin guard accept proxied requests. Keep Render's independent auto-deploy disabled; the GitHub Actions staging release coordinates migrations before triggering the backend deployment.

## Stripe test-mode payments (optional)

Encore defaults to `PAYMENT_PROVIDER=simulated`. Setting `PAYMENT_PROVIDER=stripe` switches checkout to Stripe-hosted Checkout, and this deployment guide does not enable it anywhere (`render.yaml` is unchanged). Read these restrictions before using it:

- **A booking is created only by a verified payment webhook.** The browser's return from Stripe never creates a booking; the return page only reads what Encore has recorded. A `checkout.session.completed` or `checkout.session.async_payment_succeeded` event must pass signature verification, be test mode, report `payment_status: paid`, match an Encore payment attempt and its Checkout Session, and carry the saved amount and currency. The booking, the attempt update and the event's deduplication row are then written in one transaction, so a repeated delivery is acknowledged without a second booking. If webhooks are not delivered (for example, the endpoint or the local forwarder is down), paid reservations stay unconfirmed. Stripe retries failed deliveries to a dashboard endpoint for a limited time; after that, or for a local `stripe listen` forwarder that was not running, recover by resending the event manually (Stripe Dashboard event page, or `stripe events resend <event id>`), which the deduplication makes safe to repeat. No reconciliation worker is included in this version, so nothing recovers missed payments automatically.
- **Session and hold timing.** Starting a payment creates a 35-minute Checkout Session and extends the reservation hold to 5 minutes past the session's end, but never beyond 60 minutes after the reservation was made. Cancelling on Stripe's page closes the session and allows a new one while the cap still permits it. Once a session has run out, no replacement session is offered: it would no longer fit within the 60-minute cap, so the customer is asked to make a new reservation. If Encore's clock says the session ended while Stripe still reports it open, the same session is reused.
- **Test mode and cards only.** The API refuses to start with a key that is not a Stripe test-mode key (`sk_test_...`), creates sessions that accept card payments only, and rejects any webhook event whose `livemode` is not `false`. There is no live-mode support in this version.
- **Point the Stripe webhook at the Render API URL** (`https://<render-service>/api/payments/stripe/webhook`), not at the Vercel site, unless you have explicitly verified that the Vercel rewrite forwards the raw, unmodified request body. Stripe signs the exact bytes it sends, and signature verification fails if the body is re-encoded or altered along the way. Subscribe the endpoint to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. `FRONTEND_ORIGIN` must be set, because Stripe's success and cancel URLs are built from it.
- **Apply all three Stripe migrations before running this version anywhere**, including the development database: `20261020000000_stripe_payment_lifecycle`, `20261020010000_payment_attempt_checkout_items` and `20261020020000_payment_review_reason_unexpected_session` (apply them in this order). Even in simulated mode the reservation cancel and expiry code now reads the new `payment_attempts` table, and the development database has no migration history, so baseline it first as described below. The migrations are additive, so rolling the code back is safe.
- **Do not switch from `stripe` back to `simulated` while Checkout Sessions may still be live.** A live session can still be paid for up to about 40 minutes (35-minute session plus a 5-minute grace period). In simulated mode the webhook route returns 404, so Stripe's payment notifications are not recorded (Stripe retries for days), and simulated checkout can confirm a reservation whose Stripe session is still payable, which would charge the customer and then record a duplicate payment for manual review. Switch modes only after no payment attempt is `creating` or `open` (all sessions expired or cancelled, or at least 40 minutes after stopping new payments).
- **Payments under review need manual handling.** A payment Encore cannot fulfil (late, cancelled or expired reservation, event started, unexpected amount or session) is stored as `needs_review` and logged as `payment_needs_review`; there is no refund or admin tooling yet, so refund or resolve it in the Stripe dashboard. The tickets of such a reservation are released when its hold expires. Watch for `stripe_event_unmatched` log lines as well.

## Cloudinary event posters (optional)

Administrators can give an event a custom poster from the event create and edit forms. The poster is stored in Cloudinary; PostgreSQL stores only its public ID and delivery URL on the `events` row (`poster_public_id`, `poster_url`). When an event has no custom poster (both columns `NULL`), every page keeps drawing Encore's existing generated poster, unchanged. If a stored poster image fails to load in the browser, the page also falls back to the generated poster.

- **Cloudinary setup.** Create a Cloudinary account (the free plan is enough for a portfolio deployment) and copy the cloud name, API key and API secret from the console's API Keys settings. No upload preset is needed: the Encore API signs each upload itself through the official Cloudinary Node SDK, so the browser never sees Cloudinary credentials and never talks to Cloudinary for uploads.
- **Local development.** Put `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` in the ignored `server/.env` (see `server/.env.example`), preferably with `CLOUDINARY_POSTER_FOLDER=encore-dev/event-posters` so development images stay separate. Uploads are filed in that Media Library folder (Cloudinary creates it on the first upload) and their public IDs start with the same path. Leave them blank to run without uploads; the API then answers poster uploads with HTTP `503` and nothing else changes. Never put them in `client/.env.local`.
- **Render.** Add the same variables in the Render dashboard for the `encore-api` service (they are intentionally not in `render.yaml`, like the Stripe settings). Redeploy or restart after changing them; startup fails if only some of the three are set or if `POSTER_UPLOAD_MAX_BYTES` is invalid. Nothing is needed on Vercel.
- **Upload limits and formats.** The browser sends the image file as the raw body of `POST /api/admin/events/:eventId/poster` through the existing Vercel `/api` rewrite. The API accepts only JPEG, PNG and WebP, identified from the file's leading bytes (filename extensions and the browser's declared type are not trusted, and SVG is always rejected), and refuses bodies larger than `POSTER_UPLOAD_MAX_BYTES` (default 4 MB) with HTTP `413`. Keep the limit at or below the default unless you have verified that the Vercel rewrite forwards larger request bodies. Cloudinary serves a resized (`c_limit,w_2000`), automatically formatted and compressed rendition, and each layout crops it with CSS.
- **Replacement, removal and cleanup.** Each upload uses a new public ID. The event row is switched to the new image in a transaction that locks the row and checks the `expected_poster` precondition, so a stale form gets HTTP `409` instead of overwriting or removing a newer poster. The previous image is deleted from Cloudinary only after that commit. If a Cloudinary deletion fails (or an upload fails or the process stops mid-upload), the asset stays listed in `event_poster_cleanups` and a warning named `event_poster_cleanup_pending` is logged with only the event ID, public ID and attempt count. Each later poster change retries up to two overdue cleanups (and stops at the first failure, so a Cloudinary outage does not slow responses further); to retry all of them, run `npm run posters:cleanup` from `server/` with that environment's database and Cloudinary settings. Cleanup never deletes an image an event still references.
- **Migration.** Apply `20261024000000_event_posters` before deploying this backend version (the staging workflow does this with `migrate deploy`). It only adds nullable columns, a unique index, the `event_poster_cleanups` table and check constraints, so the previously deployed backend keeps working after it is applied. The new backend reads these columns on every event query, so it cannot run against a database without them. For any database that already records the earlier migrations in `_prisma_migrations` (as the local development database did in October 2026, with all four earlier migrations finished), first confirm the target and take a backup, then from `server/` run `npx prisma migrate status --config prisma7.config.ts`; it should list only `20261024000000_event_posters` as pending, and `npx prisma migrate deploy --config prisma7.config.ts` then applies just that migration. Do not baseline a database that already has migration history. A database without any migration history must follow the baselining guidance below before `migrate deploy` is used.

## Neon connections and database releases

Create a Neon PostgreSQL project and database in the Neon console. Copy the **pooled** connection URL into Render's `DATABASE_URL` and the **direct** connection URL into `DIRECT_DATABASE_URL`. Both must point to the same intended Neon database and require TLS. The application keeps its current lazy Prisma singleton and uses the pooled URL; CLI commands use the direct URL when present. The pg adapter's pool is capped at 10 connections per Render process with a 5-second connection timeout. Size the Neon connection budget for the number of Render instances.

The repository contains an initial Prisma migration at `server/prisma/migrations/20261017000000_initial_schema/migration.sql`. It creates the seven tables, foreign keys, unique indexes, and explicit SQL check constraints that are not represented in the Prisma model. The initial migration has been applied to the intended Neon staging database. It was also applied to the separately named local `encore_migration_test` database during the original migration setup; it was not applied to the existing development database.

For staging, use the automated release workflow described below. For a **new, empty database outside that automated staging flow** (for example, a separately provisioned production database), first take the required backup/recovery precautions, then from `server/` run:

```bash
npx prisma migrate deploy --config prisma7.config.ts
```

With `DIRECT_DATABASE_URL` set, Prisma CLI uses the direct Neon URL. Run this as a controlled release operation before deploying code that depends on the new schema; do not put migrations in `npm start` or ordinary application startup.

The existing development database has no migration history. This initial migration has **not** been proven identical to that database. Before adopting migrations for an existing database, compare its complete schema and check-constraint definitions with this migration using a safe read-only schema inspection. Only after the comparison and a backup should an operator decide whether to baseline it with `prisma migrate resolve --applied 20261017000000_initial_schema --config prisma7.config.ts`. Do not run that command against an unknown or mismatched database, and do not treat it as a schema change or compatibility proof.

A read-only comparison of a copy of the local development database (October 2026) with this migration found these differences. Unique rules exist as constraints in the development database and as unique indexes in the migration, `created_at` defaults are `now()` versus `CURRENT_TIMESTAMP`, and several CHECK constraints have different names (`ticket_types_check` combines the two available-quantity checks). These are equivalent. The development database is looser in four places: `bookings_status_check` also allows `cancelled`, `events_status_check` also allows `cancelled`, and `ticket_types_price_check` and `reservation_items_unit_price_check` allow `0` where the migration requires a positive amount. No rows in that copy depended on the looser rules. The application already rejects zero prices, and a zero-amount Stripe payment attempt would be refused by `payment_attempts_amount_positive_check`. Decide whether to tighten the development database before baselining it.

For future releases, review generated SQL and custom SQL constraints, apply the migration in staging, verify application behavior and inventory invariants, back up production, and then run `migrate deploy`. Prisma migrations do not supply an automatic rollback. For a failed release, stop rollout, inspect the migration and database state, then use a reviewed forward fix or restore from a verified backup/PITR plan. Do not blindly reverse SQL or reset a database.

## Automated Neon staging migration and Render release

The `Encore Staging Release` GitHub Actions workflow runs on pushes to `main`. It calls the existing CI workflow first, then checks the required secrets and staging hostname variable, confirming the migration URL points to the configured direct Neon endpoint with database name `neondb`. CI includes backend unit/integration checks, frontend lint/build, and the sequential Chromium Playwright E2E job against the exact checked-out frontend and backend with its own disposable PostgreSQL service. The E2E database is separate from the integration-test database; both test URLs are explicit and guarded against development or remote targets. Only after every CI job succeeds does the release workflow install backend dependencies, run `npx prisma migrate deploy --config prisma7.config.ts`, and send a POST request to the Render deploy hook. The hook's `ref` query parameter is set to the exact `github.sha` checked out, validated, and migrated by that workflow run; existing hook query parameters are preserved and any prior `ref` is replaced. The CI workflow runs for pull requests and is reused by the release workflow on `main`. A concurrency group serializes staging releases, and Render's independent auto-deploy remains disabled.

The E2E browser suite runs the local Vite development server and its `/api` proxy, so it verifies browser cookie/session behavior against the matching CI backend but does not exercise Vercel's hosted rewrite service. GitHub repository branch protection/rulesets must require the CI result containing the E2E job before merging pull requests into `main`; this repository change does not configure GitHub settings.

Configure these exact **GitHub repository Actions secrets and variable** before expecting automated releases:

| Secret | Value and where to obtain it |
| --- | --- |
| `DIRECT_DATABASE_URL` | The **direct** connection URL for the intended Neon staging database (`neondb`), from the Neon dashboard's connection details. Do not use a pooled URL. |
| `RENDER_DEPLOY_HOOK_URL` | The deploy hook URL created for the Render `encore-api` web service, from that service's settings. |

| Variable | Value and where to obtain it |
| --- | --- |
| `NEON_STAGING_HOST` | The exact hostname for the intended staging project's direct `neondb` endpoint. In the Neon dashboard, open the staging project and use its connection details to view the direct connection URL; copy only the hostname portion (the value after `@` and before any `:port` or `/database`). Configure this non-secret under GitHub repository **Settings → Secrets and variables → Actions → Variables**. Do not include a scheme, credentials, port, or path. |

The workflow fails closed if any of these three values is missing or malformed. It checks that `DIRECT_DATABASE_URL` is PostgreSQL, uses a direct `*.neon.tech` endpoint rather than a pooler, names `neondb`, and has a hostname exactly matching `NEON_STAGING_HOST`. Do not put secrets in the repository, workflow logs, or client/Vercel environment. **Never configure a production database URL as the staging secret or set the variable to a production hostname.**

Monitor the `Encore Staging Release` run in the repository's **Actions** tab. The migration job fails before calling Render if a required secret or variable is missing, the target does not pass its staging checks, dependency installation fails, or Prisma reports a migration error. A failed migration means no Render deployment hook is called. Inspect the migration error and staging migration status before retrying; do not substitute `db push`, `migrate dev`, or manual DDL. A successful migration followed by a failed deploy-hook request requires checking Render's deployment activity before deciding whether to retry.

The migration is applied **before** the new backend version is deployed. Therefore, schema changes must be backward-compatible with the currently running backend during that interval. Use expand-and-contract changes for schema changes that would otherwise break the old version.

After Render finishes deploying, verify `https://encore-api-7xew.onrender.com/api/ready` returns HTTP 200 and then verify `https://encore-api-7xew.onrender.com/api/events` returns the expected successful event-catalogue response. Also check the Render deployment logs for startup errors. This workflow does not configure Vercel or independently prove browser behavior.

The seed script is for local demo/development data only. It is not run by Render startup, Vercel, or the migration workflow. Never seed a production database.

## Security and operations notes

- `/api/health` is a lightweight process liveness response. Render uses `/api/ready`, which runs a bounded `SELECT 1` through the existing Prisma client and returns only a generic 503 on failure.
- Credentialed CORS allows only the exact `FRONTEND_ORIGIN`, the HTTP methods used by the app, and `Accept`, `Content-Type`, and `Idempotency-Key` headers. Disallowed origins receive no allow-origin header. A shared API middleware also rejects unsafe requests carrying a different `Origin`, including simple-form requests, before route handlers run; non-browser clients without an `Origin` header remain supported.
- Error responses remain generic for server errors. Structured logs contain route templates, method, status, duration, and error type only; they omit raw URLs, query strings, bodies, headers, cookies, tokens, and error messages. Health and readiness probes are not request-logged.
- Express-level rate limiting exists (see [Express-level rate limiting](#express-level-rate-limiting)), but it is process-local, resets on restart, is per instance, and its IP-based limiters are intentionally off in production because the client IP cannot be identified safely across both request paths. Edge/provider protection is not implemented; do not assume the application layer alone provides brute-force or DDoS protection.
- Database connectivity and readiness are not proof of backups. Configure and test Neon retention/restore procedures before storing real customer data.

## Express-level rate limiting

The Encore API limits requests inside the Express process using `express-rate-limit`. This is the **application layer** only. **Edge protection (DDoS mitigation, a WAF, broad IP rate limiting at a CDN or proxy) is not implemented here** and is planned separately. PostgreSQL constraints, transactions and row locks remain the authority for inventory and booking correctness; the limiters never replace them.

### Limits (initial proposals, not requirements)

Every limit can be tuned without a code change with `RATE_LIMIT_<NAME>_MAX` and `RATE_LIMIT_<NAME>_WINDOW_MINUTES` on Render (a malformed value fails startup; a misspelled variable name is silently ignored, so check the name). `RATE_LIMIT_MAX_KEYS` (default 10000, minimum 100) caps how many counters each limiter holds.

A request that receives a `429` is **always given back**: it never uses up capacity or inflates a counter. The "stays counted" column lists which other responses keep a slot used.

In production the **account-keyed** limiters and the per-email login fallback are **active**. The IP-keyed limiters, and the email-plus-IP login failure limiter, are **off** in production because the client IP cannot be identified safely (see [Client IP handling and IP-based limits](#client-ip-handling-and-ip-based-limits-disabled-in-production)). The IP-keyed limiters run only when `NODE_ENV` is exactly `development` or `test`, where the socket address is the client address; production, an unset `NODE_ENV` and any other value leave them off.

| Limiter (`<NAME>`) | Applies to | Key | Default | Stays counted | Production |
| --- | --- | --- | --- | --- | --- |
| `LOGIN_IP` | `POST /api/auth/login` | IP | 20 / 15 min | every response | **off** |
| `LOGIN_FAILURE` | `POST /api/auth/login` | normalized email + IP | 5 / 15 min | only `401` (failed) logins | **off** (the next row is used instead) |
| `LOGIN_FAILURE_NO_IP` | same, **used instead of `LOGIN_FAILURE` while IP limiting is off** | normalized email | 50 / 60 min | only `401` logins | **active** |
| `REGISTRATION` | `POST /api/auth/register` | IP | 5 / 60 min | everything except validation `400`s | **off** |
| `RESERVATION_ATTEMPT` | `POST /api/reservations` | user ID | 60 / 10 min | every response (`201`, `400`, `404`, `409`, `5xx`) | **active** |
| `RESERVATION_CREATION` | `POST /api/reservations` | user ID | 10 / 10 min | only `201` (a hold was created) | **active** |
| `RESERVATION_IP` | `POST /api/reservations` | IP (backstop) | 30 / 10 min | everything except `400` and `409` | **off** |
| `RESERVATION_CANCEL` | `POST /api/reservations/:id/cancel` | user ID | 30 / 10 min | every response, including errors | **active** |
| `RESERVATION_READ` | `GET /api/reservations`, `GET /api/reservations/:id`, `GET /api/reservations/:id/payments/latest` | user ID | 200 / 10 min | every response | **active** |
| `PAYMENT_INITIATION` | `POST /api/reservations/:id/checkout` and `/payments` (one shared bucket) | user ID | 10 / 10 min | everything except `400` | **active** |
| `PAYMENT_CANCELLATION` | `POST /api/reservations/:id/payments/cancel` | user ID | 20 / 10 min | everything except `400` | **active** |
| `POSTER_MUTATION` | `POST` and `DELETE /api/admin/events/:eventId/poster` (Cloudinary) | admin user ID | 20 / 10 min | every response | **active** |
| `GENERAL_READ` | every `GET`/`HEAD` under `/api` | IP | 300 / 15 min | every response | **off** |

Design notes:

- **Exempt:** `GET /api/health`, `GET /api/ready` and `POST /api/payments/stripe/webhook` are registered before the general limiter and are also excluded inside it. The webhook is never restricted by IP; its Stripe signature check is unchanged.
- **Login.** Successful logins and validation errors are given back and never count toward the failure limit. When IP limiting is on (not in production today), failures are keyed on email **and** IP, so an attacker on another IP cannot lock a victim out; they only fill their own counter. A locked email+IP is blocked even with the right password until the window passes. The `429` is identical for registered and unknown emails.
- **No-IP login fallback (temporary, weaker).** While no trusted IP exists (production today), failed logins are counted per email alone, at 50 per hour. This is **not equivalent to email-plus-IP protection**: it slows sustained guessing against one account, but anyone can spend that shared counter, so a determined person can still keep a known email locked out, at a cost of about 50 requests per hour. It is deliberately generous so casual abuse cannot lock accounts out. It stays the production login-failure safeguard for as long as IP-based limiting is disabled; the email-plus-IP limit would replace it only if IP limiting is later enabled under the conditions below. Its store can also fill under a flood of distinct emails; see the capacity trade-off under "Counters are in memory, per process".
- **Reservations.** Two account limiters run in order after authentication. `RESERVATION_ATTEMPT` counts every request that reaches the handler, because even rejected attempts (sold out, hold cap, ticket-type mismatch) run the global expiry sweep, a per-user lock and an inventory-row lock. `RESERVATION_CREATION` counts only successful holds, which is what stops rapid create-and-cancel cycling. A request blocked by either limiter is given back by both. The existing six-ticket and two-pending-hold rules and all database locking are unchanged. Requests are counted when they arrive, so a burst of simultaneous requests can be blocked slightly early (before it is known whether they would fail); it can never admit more than the limit.
- **Reservation reads.** `RESERVATION_READ` is mounted on the whole reservations router but acts only on GET requests, which are exactly the three routes listed above (each runs the expiry sweep). Writes are skipped, so creation, cancellation, checkout and payments are never counted twice. The payment return page polls about once every 2 seconds for up to 45 polls, well inside 200 per 10 minutes.
- **Checkout / payments.** The limiter runs before the handler, so a `429` leaves no reservation, payment attempt or Stripe session behind. Replays with the same `Idempotency-Key` count like any other request; the default leaves headroom for network-error retries.
- **Cancellation** limiters: reservation cancellation counts errors too (each call runs the expiry sweep), so failing requests cannot bypass it. Payment cancellation has its own bucket so a customer who has used up payment starts can still release their hold; it is bounded because Stripe mode makes an outbound Stripe call.
- **Posters.** Only the two Cloudinary routes are limited, per admin account and before the upload body is read. Other admin event and ticket-type writes are database-only and are not limited, nor is `PATCH /api/auth/me`.
- **Responses and logging.** `429` responses use the normal `{ success: false, message }` body, include `Retry-After`, and carry CORS headers, so the existing client displays `message` unchanged. Every `429` is logged once as `{"event":"rate_limited","limiter":"…","route":"…","status":429}`: no email, IP, user ID, body, header, cookie or token is ever logged, and the route is the template (for example `/api/reservations/:reservationId/cancel`), not the URL.

### Counters are in memory, per process

Counters live in a bounded in-process store (`server/src/middleware/boundedMemoryStore.js`):

- **They reset on every restart, deploy and Render free-tier spin-down.**
- **They are per instance.** With N backend instances an attacker can send about N times each limit. This is not a distributed or durable guarantee. Render currently runs one instance (`render.yaml` sets no instance count); do not scale out without first moving the limiters to a shared store (swap the single `createStore` function in `server/src/middleware/rateLimiters.js`).
- **Memory is bounded** by `RATE_LIMIT_MAX_KEYS` counters per limiter, and emails are hashed into fixed-size keys. Expired counters are swept every minute, and a counter that is given back to zero is deleted at once.
- **Behavior at capacity.** Each limiter's store holds at most `RATE_LIMIT_MAX_KEYS` counters (default 10000). Only expired counters are ever removed to make room; a live counter is never evicted, so a flood of unique keys cannot erase an active lockout. If a store is full of live counters, requests for a **new** key are refused with `429` (and `Retry-After` set to when the earliest counter expires) until counters expire. Existing counters are not reset or changed. The flood is visible as a burst of `rate_limited` log lines.
- **Known trade-off for the production login fallback.** With production IP limiting disabled, the fallback login limiter (`LOGIN_FAILURE_NO_IP`) is keyed by email alone, and each failed login for a distinct email creates a counter that lives for the whole fallback window (60 minutes by default). A sufficiently large flood of distinct email addresses, on the order of `RATE_LIMIT_MAX_KEYS` failed attempts inside that window, could fill that store. New-email login attempts would then receive `429` responses until existing counters expire, potentially up to the 60-minute window. There is no application-level limit on how fast one address can do this while IP limiting is off. The behavior was chosen deliberately over evicting live counters, which would let the same flood erase active lockouts. It is a known limitation, not a report that the application is under attack. Raising `RATE_LIMIT_MAX_KEYS` raises the size of flood needed but does not remove the trade-off; bursts of `rate_limited` entries for limiter `loginFailureNoIp` are how to notice it.

### Client IP handling and IP-based limits (disabled in production)

**Decision: production IP-based rate limiting stays disabled, and `TRUST_PROXY_HOPS` must stay unset in production.** The code enforces the first part: production ignores `TRUST_PROXY_HOPS`. Account-based limits remain active and tested (see the table above).

**How the code behaves**

- The IP-keyed limiters (`LOGIN_IP`, `REGISTRATION`, `RESERVATION_IP`, `GENERAL_READ`) and the email-plus-IP `LOGIN_FAILURE` limiter run **only when `NODE_ENV` is exactly `development` or `test`** (case-sensitive). In production, with `NODE_ENV` unset, and with any other value (a typo such as `Production`, or `staging`) they are **off regardless of `TRUST_PROXY_HOPS`**, so a misconfiguration can never key every visitor to one shared address. Startup logs a warning when they are off. The account-keyed limiters are unaffected and stay active everywhere, and login failures use the per-email fallback described above.
- `TRUST_PROXY_HOPS` is still parsed and validated (a whole number from 1 to 5; 0 is rejected at startup in production; `true`, subnets and names are rejected), so a malformed value fails startup. **Where IP-based limiting is off, production included, the value is ignored**: Express is not told to trust any proxy, and the startup warning says the value is being ignored. Only in development and test does it take effect, with Express taking the client address that many entries from the right of `X-Forwarded-For`. The code reads only Express's `req.ip` and never parses forwarded headers itself.
- For local development, set `NODE_ENV=development` to exercise the IP-keyed limiters, which use the socket address. With `NODE_ENV` unset they are off.

**Why it stays disabled: what was measured**

Browser traffic reaches the API as Browser → Vercel `/api` rewrite → Render (behind Cloudflare) → Express ("path A"). Direct calls to the `onrender.com` URL skip Vercel ("path B"). A temporary diagnostic on 2026-11-06 (a throwaway Render service and Vercel project, since deleted; no verification task is outstanding) measured both paths on the Render free plan in Singapore: IPv4 only, four runs over about 15 minutes, from two networks.

| | Path B: direct to Render | Path A: browser → Vercel → Render |
| --- | --- | --- |
| `X-Forwarded-For` seen by Express (socket is `127.0.0.1`) | client, Cloudflare edge, Render-internal address | first entry, Vercel egress address, Cloudflare edge, Render-internal address |
| Infrastructure entries after the client | 2 (hop count **3**, counting the local socket hop) | 3 (a count of 4 would be needed to reach the first entry) |
| A client-supplied `X-Forwarded-For` | stays to the left of the infrastructure entries | **sometimes kept in the first slot in place of the real client** (3 of 4 runs) and sometimes overwritten, so it is unreliable |

What follows from that:

- A hop count of **3 identifies the client only on path B**. On path A, where browsers go, it returns Vercel's egress address, so every visitor would share a handful of buckets and the site would throttle itself.
- A larger count on path A would use the first slot, which a client can set (spoofable). A count larger than the real chain lets Express fall through to the left-most entry, which a client can set.
- **No single `TRUST_PROXY_HOPS` value safely serves both paths. Do not set `TRUST_PROXY_HOPS=3`, or any other value, for the current Vercel-to-Render architecture.** The measured 3 describes path B only.

Other behavior observed (the code does not rely on any of it): `X-Real-IP` was not forwarded; a client-supplied `CF-Connecting-IP` was rejected by Cloudflare with a 403; `True-Client-IP` was overwritten. On path A, Vercel's `X-Vercel-Forwarded-For` and `Forwarded` carried the real client and overwrote forged values in every run, but on path B a client can send both freely. These are observations, not platform guarantees, and they can change. IPv6 was not tested.

**What this leaves unprotected in production:** credential stuffing across many different accounts from one address, registration floods (each costs a bcrypt hash), and public catalogue reads. Edge or provider protection (DDoS mitigation, a WAF, broad IP rate limiting) is the intended place for that and is not implemented.

**Conditions required before IP-based limits can be enabled** (all of them):

1. **A single trusted ingress.** For example, serve the API through a dedicated API domain that reaches Render directly, with no Vercel `/api` rewrite for browser traffic, so one chain applies to real users. The alternative is a separately designed and verified approach that proves a request came through Vercel before using a Vercel-set client address; that needs a code design that reads something other than `req.ip` and is not implemented.
2. **Fresh measurements on the exact hostnames that will serve the API.** The results above do not cover a custom domain. Measure the chain, including forged-header tests, more than one network and IPv6, in a staging deployment using temporary resources, and delete those afterwards. If the `onrender.com` URL stays reachable alongside an API domain, measure that path too.
3. **Only then** change the code to allow IP limiting in production (it deliberately ignores `TRUST_PROXY_HOPS` there today), set `TRUST_PROXY_HOPS` in the Render dashboard to the measured count, add it to `render.yaml`, and confirm with test accounts that two different clients get separate counters and that a forged `X-Forwarded-For` does not reset one.
4. **Re-verify after any change** to hosting, proxies or the CDN, because these results show platform behavior can vary.

## Manual staging verification checklist

Do not mark these complete until they have been performed against the deployed staging services:

### Hosting and availability
- [x] Vercel builds the client and serves a direct load/refresh of event, account, checkout, booking, and admin client routes.
- [x] Render starts on its supplied port and binds on `0.0.0.0`.
- [x] Render `/api/health` remains live independently of PostgreSQL.
- [x] Render `/api/ready` succeeds when Neon is reachable and returns generic 503 when it is unavailable.
- [x] Unknown API routes return API errors, not the frontend HTML.
- [x] Vercel static assets still load under the SPA rewrite.

### Authentication and origins
- [x] Vercel Production build uses the `/api` proxy (production code forces same-origin); remove any obsolete `VITE_API_BASE_URL` setting. Preview builds also use same-origin proxying, but auth is allowed only if Render's exact `FRONTEND_ORIGIN` is configured for that preview origin.
- [x] Render `FRONTEND_ORIGIN` exactly matches the browser-visible Vercel origin used for the test.
- [x] Registration, login, refresh-based session restoration, logout, and protected routes work in supported browsers.
- [x] Admin routes deny customers; backend authorization is still enforced independently of UI routing.
- [x] Allowed origin requests receive credentialed CORS and valid preflights; disallowed origins do not.
- [x] Cookie `HttpOnly`, `Secure`, and `SameSite` attributes match the chosen custom-domain or proxy topology.
- [x] Browser requests use the Vercel `/api` proxy; direct `onrender.com` calls are not assumed to work with first-party cookie settings.

### Booking and operations
- [x] Catalogue, details, search, sorting, availability, pagination, and booking pages load through the deployed API.
- [x] Reservations, expiration/cancellation inventory restoration, checkout idempotency, booking ownership, and admin ticket management work.
- [x] Existing concurrency tests pass against the dedicated test database.
- [x] Production secrets exist only in Render settings; no server credentials appear in Vercel's client build.
- [x] Neon backup retention and a restore procedure have been reviewed and tested.
- [x] Logs contain no credentials, cookies, tokens, passwords, or personal request bodies.
- [x] The initial schema migration is compatible with the exact target database before it is applied or baselined.

### Event posters (after configuring Cloudinary on Render)
- [ ] `20261024000000_event_posters` is applied to the target database before the new backend runs.
- [ ] Events without a custom poster still show the generated poster on Discover, event details, and the admin workspace.
- [ ] An admin can upload, preview, replace, and remove a poster through the Vercel `/api` proxy; removal restores the generated poster.
- [ ] Customers and signed-out users receive `403`/`401` from the poster endpoints.
- [ ] Oversized, SVG, and non-image uploads are rejected with clear messages.
- [ ] Replaced and removed images disappear from the Cloudinary media library, and no `event_poster_cleanup_pending` warnings remain unresolved.
- [ ] Cloudinary credentials appear only in Render settings, not in Vercel, the client build, or logs.
