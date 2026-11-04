# Backend testing

Encore uses Node.js's built-in `node:test` runner. It works with the project's Node.js 24 CommonJS backend and needs no additional test dependencies. Tests live in the repository-level `tests/` directory so the project has one shared test location.

## Test suites

- `tests/unit/` exercises request validation, reservation price serialization, the test-database safety guard, deployment configuration, origin protection, and the public error response without connecting to PostgreSQL.
- `tests/integration/` sends HTTP requests through the exported Express app and exercises authentication, events, reservations, inventory, checkout, and bookings against real Prisma/PostgreSQL.
- `tests/run.cjs` discovers `.test.cjs` files and invokes Node's test runner. Integration files run sequentially; individual race tests coordinate their HTTP requests at a barrier.

From `server/`, run the database-independent tests with:

```powershell
npm test
```

Run database-backed tests separately with:

```powershell
npm run test:integration
```

`npm run test:all` runs both suites and requires the dedicated database described below.

## Dedicated PostgreSQL test database

Integration tests require an explicit `TEST_DATABASE_URL`; they never fall back to `DATABASE_URL`. The database name must contain a distinct `test` segment, such as `encore_test`. The test helper loads only `server/.env.test` (if present), then points the existing lazy Prisma singleton at that URL. It does not load `server/.env` as a test configuration source.

Create a separate empty PostgreSQL database named `encore_test` using your local PostgreSQL administration tool. Do not use the normal `encore` development database. The integration suite checks that all seven tables are empty before it starts; if a prior interrupted run left data behind, it fails without deleting those rows. The reviewed initial migration is the canonical schema setup. Prepare a newly created dedicated test database from `server/` by pointing both Prisma URLs at that test database and applying the migration:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://<user>:<url-encoded-password>@localhost:5432/encore_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_DATABASE_URL = $env:TEST_DATABASE_URL
npx prisma migrate deploy --config prisma7.config.ts
npm run test:integration
```

Alternatively, put only the `TEST_DATABASE_URL` setting in an ignored `server/.env.test` file and run `npm run test:integration` after preparing the schema with the migration command. The test helper sets `DATABASE_URL` to the same explicit test URL before loading the application. A normal development database named `encore` is rejected by the safety guard. Never put real credentials in tracked documentation or `.env.example`.

Migration application is a manual, explicit setup step and is not run by the integration test command. Confirm both configured URLs point at the dedicated test database before applying it. Integration tests never run resets, truncations, migrations, or broad cleanup.

## Stripe payment tests

`tests/integration/payments.test.cjs` covers the Stripe-hosted Checkout lifecycle against the same guarded `TEST_DATABASE_URL` database and its migrations (the suite also needs `20261020000000_stripe_payment_lifecycle`, `20261020010000_payment_attempt_checkout_items` and `20261020020000_payment_review_reason_unexpected_session` applied). It never uses live Stripe credentials or the network: it sets dummy test-only `PAYMENT_PROVIDER`/`STRIPE_*` values for its own process, replaces Checkout Session creation with an in-memory fake that replays by idempotency key like Stripe, and signs webhook bodies locally with the Stripe library's test-header helper. It covers payment-mode enforcement, server-priced initiation and hold extension, duplicate and concurrent initiation, recovery of a lost Stripe response, abandoned attempts, signature rejection, single fulfilment, duplicate and concurrent deliveries, rollback of the deduplication row, late/cancelled/started-event/mismatched payments flagged for review, refusal of a second payment after a paid or under-review attempt, rejection of live-mode events, the event-start versus session-end boundary, stable retry parameters after a rename, elapsed open sessions (reused while Stripe reports them open, closed without a replacement once Stripe confirms they expired, including a real-timeline case that moves the process clock instead of editing rows), the 32-minute resume threshold, recording malformed or unexpected paid events for review, safe cancellation of an open Stripe session (expired, already expired, already complete, network failure, racing a webhook, racing session creation, repeats), out-of-order events, and database constraints. `tests/unit/paymentConfig.test.cjs` and `tests/unit/stripeWebhookSignature.test.cjs` need no database. The older integration suite forces `PAYMENT_PROVIDER=simulated` so `server/.env` cannot change it.

Reservation holds are written and compared with application time everywhere (reserve, expiry, simulated checkout, payment); only the event-start cutoff uses PostgreSQL time. If your local PostgreSQL `TimeZone` is not UTC, Prisma-written timestamps and PostgreSQL's clock can disagree by the offset. Both integration suites pass in that setup, but setting `PGOPTIONS="-c TimeZone=UTC"` for the test run (or `ALTER DATABASE encore_test SET TimeZone TO 'UTC'`) removes the difference.

## Event poster tests

`tests/integration/eventPosters.test.cjs` covers admin event posters against the same guarded `TEST_DATABASE_URL` database; it also needs the `20261024000000_event_posters` migration applied. It never uses Cloudinary credentials or the network: it sets dummy test-only `CLOUDINARY_*` values (and a 4 KB `POSTER_UPLOAD_MAX_BYTES`) for its own process and replaces Cloudinary uploads and deletions with an in-memory gateway that can be told to fail. It covers events without a poster keeping the default (`poster_url: null`); attaching the verified asset and exposing it on Discover, event details and the admin list; replacement with old-asset deletion; removal and repeated removal; admin-only access (`401`/`403`); rejection of SVG, disguised, truncated, GIF, multipart, JSON, compressed, empty and oversized bodies and malformed preconditions without contacting Cloudinary; the unconfigured `503`; Cloudinary upload and deletion failures and unexpected results; a database failure inside the attach transaction; an upload that outlives its attach window; stale preconditions, uploads overtaken by another change, concurrent uploads and a racing removal/replacement (the attached asset is never deleted); the delayed cleanup sweep; unchanged ticket types, inventory, reservations and bookings; and the database check constraints. `tests/unit/eventPosters.test.cjs` covers content sniffing, configuration validation, the upload middleware's type and size checks, URL building, serialization and the DELETE preflight without a database.

## Fixtures, cleanup, and concurrency

The integration suite creates uniquely named users and event fixtures. It tracks their IDs and removes only those records, deleting bookings and reservation items before their parent rows to respect foreign keys. No seed data is required. The suite uses the same application, services, Prisma singleton, adapter, and PostgreSQL transactions as the backend.

For inventory and checkout race tests, two HTTP operations wait at a shared in-process barrier and are released together. The tests then inspect PostgreSQL to assert final inventory and booking counts; they do not mock transactions or rely on sleeps. Event-cutoff race tests hold a PostgreSQL lock from a separate connection and, in one query, confirm that exactly one application backend is blocked at the marked statement while database time is still before the event start, then release the lock after the cutoff. Integration test files are run one at a time to keep their cleanup isolated.

The current tests cover registration and login, session/profile/logout behavior, public event visibility and catalogue query validation, search, availability filtering, stable paginated results and filtered counts, reservation validation and ownership, inventory decrement/restoration, expiration/cancellation races, final-ticket contention, checkout totals and rollback, idempotency-key validation and replay, same-key and different-key checkout races, failed-checkout retries, cross-user isolation, booking ownership, admin authorization, dashboard metric aggregation and zero states, and admin event management. Past and exactly-at-cutoff published events are excluded from Discover and cannot be reserved or checked out; their public details, ticket information, admin visibility, and existing booking history remain accessible. Admin HTTP tests check unauthenticated (`401`) and customer (`403`) access, verify role revocation, exercise event creation/editing and draft/published visibility, reject invalid and past-date payloads, confirm dashboard counts and upcoming-event filtering, and verify dashboard reads do not change ticket inventory. Ticket-type coverage verifies authorization, CRUD validation, duplicate names, saved reservation prices, committed inventory protection, and concurrent reservation/capacity changes. An unchanged past date on a legacy event does not block unrelated edits. Tests also verify that registration and profile updates cannot grant the admin role.

Run the admin security integration coverage with `npm run test:integration` from `server/`, using only the dedicated empty PostgreSQL database configured through `TEST_DATABASE_URL` as described above. To provision a real administrator, first create an account through public registration, verify the `DATABASE_URL` in `server/.env` points to the intended local database, then run `npm run admin:promote -- owner@example.com` from `server/`. The command promotes only the explicitly supplied existing account; it is never part of startup, seed, or test setup.

## Browser E2E tests

Encore's Playwright suite lives in `client/e2e/` because it drives the React application in a real browser. From `client/`, `npm run test:e2e` runs the twelve sequential Chromium scenarios, including the six-ticket reservation maximum, the stock-limited quantity selector, and the two-pending-reservation limit. The Playwright config starts the backend with `npm start` and the Vite development server, and refuses to reuse already-running servers so a stale API cannot accidentally be tested. It also sets `PAYMENT_PROVIDER=simulated` for that backend process only, so the simulated-checkout scenarios run even if `server/.env` selects Stripe; no `.env` file is changed and normal startup is unaffected. Vite proxies browser `/api` requests to that backend.

The suite requires a separate disposable PostgreSQL database named exactly `encore_e2e_test`, on `localhost` or `127.0.0.1`, with the `public` schema. `npm run e2e:database -- preflight` checks that `TEST_DATABASE_URL`, `DATABASE_URL`, and `DIRECT_DATABASE_URL` are all explicitly set to the same URL, that the URL targets `localhost` or `127.0.0.1` and the database `encore_e2e_test` (a `schema` parameter, if present, must be `public`), and that the required E2E run variables are set. It reuses the integration suite's PostgreSQL URL/name validator and adds the stricter database-name and loopback-host checks. After connecting, it confirms the live connection reports `encore_e2e_test` and the `public` schema, then inspects the database:

- A completely empty database (no tables in `public`) is accepted, so migrations can be applied to it for the first time.
- A database that already has tables is accepted only if its `public` tables are exactly the expected Encore tables plus `_prisma_migrations`, and the names recorded in `_prisma_migrations` exactly match the repository's migration folders, with every migration finished and none rolled back.
- Unexpected tables, missing tables, a partly migrated database, or any other migration history make preflight fail. Preflight never changes data or schema.

Preflight compares table names and migration names only; it does not compare columns, migration checksums, or row contents. Row emptiness is enforced separately: `fixtures` refuses to run unless the Encore tables are empty. The CI job supplies all three URLs explicitly, applies only the checked-in migrations to its separate ephemeral PostgreSQL service, then creates fixtures.

For local E2E execution, install backend and frontend packages with `npm ci` from `server/` and `client/`, then prepare a local PostgreSQL database named `encore_e2e_test` (new and empty, or already fully migrated as described above); do not point these variables to the development, integration-test, staging, or production database. In PowerShell, set all three variables to the exact same URL and provide test-only values:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://<local-user>:<url-encoded-password>@localhost:5432/encore_e2e_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_DATABASE_URL = $env:TEST_DATABASE_URL
$env:E2E_RUN_ID = 'local-run-1'
$env:E2E_ADMIN_EMAIL = 'encore-e2e-local-run-1@example.test'
$env:E2E_ADMIN_PASSWORD = 'a-test-only-password-longer-than-12'
$env:E2E_EVENT_ID = 'a2000000-0000-4000-8000-000000000001'
```

Then, from `server/`, validate and prepare only that disposable database. The migration command is needed for a new empty database; it applies only migrations that are not recorded yet, and is a no-op when all are applied. Run preflight again afterward to confirm the final state:

```powershell
npm run e2e:database -- preflight
npx prisma migrate deploy --config prisma7.config.ts
npm run e2e:database -- preflight
npm run e2e:database -- fixtures
```

From `client/`, install Chromium once and run the suite:

```powershell
npx playwright install chromium
npm run test:e2e
```

Afterward, run `npm run e2e:database -- cleanup` from `server/` to remove the records that run created: the administrator and `encore-e2e-<run id>.` customer accounts (the `.` ends the run ID exactly, so run `local` can never match run `local-m2-1`), the fixture events and events titled `Encore E2E <run id> …` (including events the scenarios create), their ticket types, and those accounts' reservations, bookings, idempotency keys, payment attempts, and linked webhook rows. Records belonging to other runs or other data are not selected. `fixtures` and `cleanup` apply the same environment-variable and URL-target checks as preflight and also query `current_database()` and `current_schema()` on their live connection, refusing to read or write unless it is `encore_e2e_test` / `public`; they do not re-check migration history. `fixtures` requires all ten Encore tables, including `event_poster_cleanups`, to be empty. `npm run test:e2e` runs preflight first through the `pretest:e2e` script; running `npx playwright test` directly skips that step but still validates the URL variables. CI's PostgreSQL service is disposable and is discarded with its job even if a test fails. E2E setup and cleanup never run against staging or production. The browser suite uses Vite's local `/api` proxy; it does not exercise Vercel's hosted rewrite itself. The existing Vercel rewrite unit test remains responsible for checking that configuration.
