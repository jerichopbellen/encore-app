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
| `NODE_ENV` | Yes | Set to `production`; enables secure cookies and production startup checks. |
| `DATABASE_URL` | Yes | Neon pooled PostgreSQL URL for API queries, including `sslmode=require`. |
| `DIRECT_DATABASE_URL` | Yes before migration operations | Neon direct URL for Prisma CLI and schema migration commands, targeting the same database. |
| `JWT_SECRET` | Yes | Random private signing secret of at least 32 bytes; never expose it to Vercel. |
| `FRONTEND_ORIGIN` | Yes | Exact HTTPS origin of the deployed frontend; no path or trailing slash. |
| `COOKIE_SAME_SITE` | Optional | Keep `lax` for the Vercel `/api` proxy. Do not use `none` to compensate for direct cross-site provider-host requests. |
| `JWT_EXPIRES_IN` | Optional | Defaults to `1d`. |
| `PORT` | No | Supplied by Render. Do not hardcode a dashboard value. |

`render.yaml` marks secrets as dashboard-managed and contains no credentials. It does not create a Neon database or run migrations during application startup. Set Render's `FRONTEND_ORIGIN` to the exact browser-visible Vercel origin (currently `https://encore-app-theta.vercel.app`) so CORS and the unsafe-request Origin guard accept proxied requests. Keep Render's independent auto-deploy disabled; the GitHub Actions staging release coordinates migrations before triggering the backend deployment.

## Neon connections and database releases

Create a Neon PostgreSQL project and database in the Neon console. Copy the **pooled** connection URL into Render's `DATABASE_URL` and the **direct** connection URL into `DIRECT_DATABASE_URL`. Both must point to the same intended Neon database and require TLS. The application keeps its current lazy Prisma singleton and uses the pooled URL; CLI commands use the direct URL when present. The pg adapter's pool is capped at 10 connections per Render process with a 5-second connection timeout. Size the Neon connection budget for the number of Render instances.

The repository contains an initial Prisma migration at `server/prisma/migrations/20261017000000_initial_schema/migration.sql`. It creates the seven tables, foreign keys, unique indexes, and explicit SQL check constraints that are not represented in the Prisma model. The initial migration has been applied to the intended Neon staging database. It was also applied to the separately named local `encore_migration_test` database during the original migration setup; it was not applied to the existing development database.

For staging, use the automated release workflow described below. For a **new, empty database outside that automated staging flow** (for example, a separately provisioned production database), first take the required backup/recovery precautions, then from `server/` run:

```bash
npx prisma migrate deploy --config prisma7.config.ts
```

With `DIRECT_DATABASE_URL` set, Prisma CLI uses the direct Neon URL. Run this as a controlled release operation before deploying code that depends on the new schema; do not put migrations in `npm start` or ordinary application startup.

The existing development database has no migration history. This initial migration has **not** been proven identical to that database. Before adopting migrations for an existing database, compare its complete schema and check-constraint definitions with this migration using a safe read-only schema inspection. Only after the comparison and a backup should an operator decide whether to baseline it with `prisma migrate resolve --applied 20261017000000_initial_schema --config prisma7.config.ts`. Do not run that command against an unknown or mismatched database, and do not treat it as a schema change or compatibility proof.

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
- Authentication rate limiting is not implemented here. A process-local limiter would be bypassable across Render instances and depends on a correctly trusted proxy chain for client IPs. Before public launch, configure suitable edge/provider protection or scope a shared, tested limiter separately; do not assume this code provides brute-force protection.
- Database connectivity and readiness are not proof of backups. Configure and test Neon retention/restore procedures before storing real customer data.

## Manual staging verification checklist

Do not mark these complete until they have been performed against the deployed staging services:

### Hosting and availability
- [ ] Vercel builds the client and serves a direct load/refresh of event, account, checkout, booking, and admin client routes.
- [ ] Render starts on its supplied port and binds on `0.0.0.0`.
- [ ] Render `/api/health` remains live independently of PostgreSQL.
- [ ] Render `/api/ready` succeeds when Neon is reachable and returns generic 503 when it is unavailable.
- [ ] Unknown API routes return API errors, not the frontend HTML.
- [ ] Vercel static assets still load under the SPA rewrite.

### Authentication and origins
- [ ] Vercel Production build uses the `/api` proxy (production code forces same-origin); remove any obsolete `VITE_API_BASE_URL` setting. Preview builds also use same-origin proxying, but auth is allowed only if Render's exact `FRONTEND_ORIGIN` is configured for that preview origin.
- [ ] Render `FRONTEND_ORIGIN` exactly matches the browser-visible Vercel origin used for the test.
- [ ] Registration, login, refresh-based session restoration, logout, and protected routes work in supported browsers.
- [ ] Admin routes deny customers; backend authorization is still enforced independently of UI routing.
- [ ] Allowed origin requests receive credentialed CORS and valid preflights; disallowed origins do not.
- [ ] Cookie `HttpOnly`, `Secure`, and `SameSite` attributes match the chosen custom-domain or proxy topology.
- [ ] Browser requests use the Vercel `/api` proxy; direct `onrender.com` calls are not assumed to work with first-party cookie settings.

### Booking and operations
- [ ] Catalogue, details, search, sorting, availability, pagination, and booking pages load through the deployed API.
- [ ] Reservations, expiration/cancellation inventory restoration, checkout idempotency, booking ownership, and admin ticket management work.
- [ ] Existing concurrency tests pass against the dedicated test database.
- [ ] Production secrets exist only in Render settings; no server credentials appear in Vercel's client build.
- [ ] Neon backup retention and a restore procedure have been reviewed and tested.
- [ ] Logs contain no credentials, cookies, tokens, passwords, or personal request bodies.
- [ ] The initial schema migration is compatible with the exact target database before it is applied or baselined.
