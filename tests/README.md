# Backend testing

Encore uses Node.js's built-in `node:test` runner. It works with the project's Node.js 24 CommonJS backend and needs no additional test dependencies. Tests live in the repository-level `tests/` directory so the project has one shared test location.

## Test suites

- `tests/unit/` exercises request validation, reservation price serialization, the test-database safety guard, deployment configuration, origin protection, and the public error response without connecting to PostgreSQL.
- `tests/integration/` sends HTTP requests through the exported Express app (or calls the backend services directly) and exercises authentication, events, reservations, inventory, checkout, and bookings against real Prisma/PostgreSQL. The files are `backend.test.cjs`, `payments.test.cjs`, `eventPosters.test.cjs`, `reservationLockOrder.test.cjs`, and `reservationItemQuantityLimit.test.cjs`.
- `tests/run.cjs` discovers `.test.cjs` files and invokes Node's test runner. Integration files run sequentially (`--test-concurrency=1`); individual race tests coordinate their HTTP requests at a barrier.

From `server/`, run the database-independent tests with:

```powershell
npm test
```

Run database-backed tests separately with:

```powershell
npm run test:integration
```

`npm run test:all` runs both suites and requires the dedicated database described below.

### Running individual test files

From `server/`, a single file can be run with Node's test runner directly. Integration files share one database, so run them one at a time and never in parallel:

```powershell
node --test ..\tests\unit\reservationValidator.test.cjs
node --test --test-concurrency=1 ..\tests\integration\reservationLockOrder.test.cjs
```

Each integration file performs its own database identity and empty-database checks, so running it on its own is as safe as running the whole suite.

### Database separation

Each suite has its own local PostgreSQL database, and each guard rejects every other name:

| Database | Used by | How the URL is supplied | Guard |
| --- | --- | --- | --- |
| `encore_test` | Integration tests | `TEST_DATABASE_URL` in the ignored `server/.env.test` (or the shell) | `validateIntegrationDatabaseUrl` + `assertConnectedToIntegrationDatabase` in `tests/helpers/testDatabase.cjs` |
| `encore_e2e_test` | Playwright E2E | `TEST_DATABASE_URL`, `DATABASE_URL`, and `DIRECT_DATABASE_URL`, all set explicitly in the shell to the same URL | `validateE2eDatabaseTarget` + `assertConnectedToE2eDatabase` in `client/e2e/support/databaseSafety.cjs` |
| `encore` (development) | Local development only | `DATABASE_URL` in `server/.env` | Rejected by both test guards |

The integration suite never reads the E2E variables and the E2E tooling never reads `server/.env.test`. Do not point an E2E variable at `encore_test` or the reverse.

## Dedicated PostgreSQL test database

Integration tests require an explicit `TEST_DATABASE_URL`; they never fall back to `DATABASE_URL`. The URL must use the PostgreSQL protocol, a loopback host (`localhost`, `127.0.0.1`, or `[::1]`), the database named exactly `encore_test`, and (if a `schema` parameter is present) the `public` schema. The test helper loads only `server/.env.test` (if present; variables already set in the shell take precedence), validates the URL, then points the existing lazy Prisma singleton at it. It does not load `server/.env` as a test configuration source. Before any read or write, each integration file also confirms that the live connection reports `current_database() = encore_test` and `current_schema() = public`.

Create a separate empty PostgreSQL database named `encore_test` using your local PostgreSQL administration tool. Do not use the normal `encore` development database. Each integration file checks that the Encore tables are empty before it starts (`eventPosters.test.cjs` also checks `event_poster_cleanups`); if a prior interrupted run left data behind, it fails without deleting those rows. The checked-in migrations in `server/prisma/migrations/` are the canonical schema setup. Several CHECK constraints (inventory bounds, status values, the 1–6 reservation item quantity) exist only in that migration SQL, so prepare the database with `migrate deploy` rather than `prisma db push`; a schema created another way passes the identity checks but lacks those constraints. Prepare a newly created dedicated test database from `server/` by pointing both Prisma URLs at that test database and applying the migrations:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://<user>:<url-encoded-password>@localhost:5432/encore_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_DATABASE_URL = $env:TEST_DATABASE_URL
npx prisma migrate deploy --config prisma7.config.ts
npm run test:integration
```

Alternatively, put only the `TEST_DATABASE_URL` setting in an ignored `server/.env.test` file and run `npm run test:integration` after preparing the schema with the migration command. The test helper sets `DATABASE_URL` to the same explicit test URL before loading the application. A normal development database named `encore` is rejected by the safety guard. Never put real credentials in tracked documentation or `.env.example`.

Migration application is a manual, explicit setup step and is not run by the integration test command. Confirm both configured URLs point at the dedicated test database before applying it. Integration tests never run resets, truncations, migrations, or broad cleanup.

Prisma CLI does not read `server/.env.test`. `server/prisma7.config.ts` loads `server/.env` and prefers `DIRECT_DATABASE_URL` over `DATABASE_URL`, but never overrides variables already set in the shell. Always set **both** `DATABASE_URL` and `DIRECT_DATABASE_URL` to the test URL for a test-database migration command; setting only one can leave the other pointing at the development database from `server/.env`.

After pulling a branch that adds a migration, bring an existing `encore_test` up to date the same way, then confirm it:

```powershell
npx prisma migrate status --config prisma7.config.ts   # expect: Database schema is up to date!
```

`reservationItemQuantityLimit.test.cjs` fails immediately with an explicit message if `20261107000000_reservation_item_quantity_limit` has not been applied.

## Stripe payment tests

`tests/integration/payments.test.cjs` covers the Stripe-hosted Checkout lifecycle against the same guarded `TEST_DATABASE_URL` database and its migrations (the suite needs `20261020000000_stripe_payment_lifecycle`, `20261020010000_payment_attempt_checkout_items` and `20261020020000_payment_review_reason_unexpected_session` applied; in practice apply every migration). It never uses live Stripe credentials or the network: it sets dummy test-only `PAYMENT_PROVIDER`/`STRIPE_*` values for its own process, replaces Checkout Session creation with an in-memory fake that replays by idempotency key like Stripe, and signs webhook bodies locally with the Stripe library's test-header helper. It covers payment-mode enforcement, server-priced initiation and hold extension, duplicate and concurrent initiation, recovery of a lost Stripe response, abandoned attempts, signature rejection, single fulfilment, duplicate and concurrent deliveries, rollback of the deduplication row, late/cancelled/started-event/mismatched payments flagged for review, refusal of a second payment after a paid or under-review attempt, rejection of live-mode events, the event-start versus session-end boundary, stable retry parameters after a rename, elapsed open sessions (reused while Stripe reports them open, closed without a replacement once Stripe confirms they expired, including a real-timeline case that moves the process clock instead of editing rows), the 32-minute resume threshold, recording malformed or unexpected paid events for review, safe cancellation of an open Stripe session (expired, already expired, already complete, network failure, racing a webhook, racing session creation, repeats), out-of-order events, and database constraints. `tests/unit/paymentConfig.test.cjs` and `tests/unit/stripeWebhookSignature.test.cjs` need no database. The older integration suite forces `PAYMENT_PROVIDER=simulated` so `server/.env` cannot change it.

Reservation holds are written and compared with application time everywhere (reserve, expiry, simulated checkout, payment); only the event-start cutoff uses PostgreSQL time. If your local PostgreSQL `TimeZone` is not UTC, Prisma-written timestamps and PostgreSQL's clock can disagree by the offset. Both integration suites pass in that setup, but setting `PGOPTIONS="-c TimeZone=UTC"` for the test run (or `ALTER DATABASE encore_test SET TimeZone TO 'UTC'`) removes the difference.

## Event poster tests

`tests/integration/eventPosters.test.cjs` covers admin event posters against the same guarded `TEST_DATABASE_URL` database; it also needs the `20261024000000_event_posters` migration applied. It never uses Cloudinary credentials or the network: it sets dummy test-only `CLOUDINARY_*` values (and a 4 KB `POSTER_UPLOAD_MAX_BYTES`) for its own process and replaces Cloudinary uploads and deletions with an in-memory gateway that can be told to fail. It covers events without a poster keeping the default (`poster_url: null`); attaching the verified asset and exposing it on Discover, event details and the admin list; replacement with old-asset deletion; removal and repeated removal; admin-only access (`401`/`403`); rejection of SVG, disguised, truncated, GIF, multipart, JSON, compressed, empty and oversized bodies and malformed preconditions without contacting Cloudinary; the unconfigured `503`; Cloudinary upload and deletion failures and unexpected results; a database failure inside the attach transaction; an upload that outlives its attach window; stale preconditions, uploads overtaken by another change, concurrent uploads and a racing removal/replacement (the attached asset is never deleted); the delayed cleanup sweep; unchanged ticket types, inventory, reservations and bookings; and the database check constraints. `tests/unit/eventPosters.test.cjs` covers content sniffing, configuration validation, the upload middleware's type and size checks, URL building, serialization and the DELETE preflight without a database.

## Reservation locking and quantity-limit tests

`tests/integration/reservationLockOrder.test.cjs` calls the reservation service directly and uses PostgreSQL's own lock-wait state (`pg_stat_activity` and `pg_blocking_pids`) instead of timing. Each test holds a lock from a separate connection, then waits for the application backend to be reported as blocked by that connection at the expected statement:

- Two concurrent cancellations whose expiry sweeps see different due holds must not deadlock (`40P01`). This guards the single sorted ticket-lock order in `cancelReservation`.
- `createReservation` must block on the user row's `FOR NO KEY UPDATE` lock (the `encore-reservation-user-lock` statement) before it counts pending holds or changes inventory. The test fails at once if creation finishes without waiting.

Both tests assert the resulting inventory and reservation state, not only the outcome.

`tests/integration/reservationItemQuantityLimit.test.cjs` checks `reservation_items_quantity_range_check` in PostgreSQL itself:

- Quantities 1 and 6 are accepted.
- 0 and 7 are rejected with SQLSTATE `23514` on insert and update.
- A rejected write inside a reservation-shaped transaction leaves no reservation, item, or inventory change.
- The normal API still rejects 7 and 8 with HTTP `400` before reaching the database.

## Expected `api_error` log lines

Several integration tests deliberately cause server errors to prove that failures roll back cleanly. The error middleware logs every response of 500 or above as a one-line `{"event":"api_error",...}` JSON record, so these lines appear in passing runs:

- `backend.test.cjs`, checkout idempotency: one `500` from `POST /:reservationId/checkout`. The test inserts a booking directly so the checkout's booking insert violates the unique `bookings.reservation_id` constraint. It then asserts the generic 500 message, that the reservation is still `pending`, that no idempotency key was stored, and that a retry with the same key succeeds.
- `payments.test.cjs`: `502` responses from simulated Stripe and network failures, and one `500` from the webhook when fulfilment is made to fail and must roll back.
- `eventPosters.test.cjs`: `502`/`503` responses from simulated Cloudinary failures and the unconfigured state, and one `500` from a simulated database failure.

A failing assertion, not the presence of these lines, indicates a problem.

## Fixtures, cleanup, and concurrency

The integration suite creates uniquely named users and event fixtures. It tracks their IDs and removes only those records, deleting bookings and reservation items before their parent rows to respect foreign keys. No seed data is required. The suite uses the same application, services, Prisma singleton, adapter, and PostgreSQL transactions as the backend.

For inventory and checkout race tests, two HTTP operations wait at a shared in-process barrier and are released together. The tests then inspect PostgreSQL to assert final inventory and booking counts; they do not mock transactions or rely on sleeps. Event-cutoff race tests hold a PostgreSQL lock from a separate connection and, in one query, confirm that exactly one application backend is blocked at the marked statement while database time is still before the event start, then release the lock after the cutoff. Integration test files are run one at a time to keep their cleanup isolated.

The current tests cover registration and login, session/profile/logout behavior, public event visibility and catalogue query validation, search, availability filtering, stable paginated results and filtered counts, reservation validation and ownership, the six-ticket reservation limit (in the API and in a database CHECK constraint), the two-pending-reservation account limit and its per-user lock, inventory decrement/restoration, expiration/cancellation races, cancellation lock ordering, final-ticket contention, checkout totals and rollback, idempotency-key validation and replay, same-key and different-key checkout races, failed-checkout retries, cross-user isolation, booking ownership, admin authorization, dashboard metric aggregation and zero states, and admin event management. Past and exactly-at-cutoff published events are excluded from Discover and cannot be reserved or checked out; their public details, ticket information, admin visibility, and existing booking history remain accessible. Admin HTTP tests check unauthenticated (`401`) and customer (`403`) access, verify role revocation, exercise event creation/editing and draft/published visibility, reject invalid and past-date payloads, confirm dashboard counts and upcoming-event filtering, and verify dashboard reads do not change ticket inventory. Ticket-type coverage verifies authorization, CRUD validation, duplicate names, saved reservation prices, committed inventory protection, and concurrent reservation/capacity changes. An unchanged past date on a legacy event does not block unrelated edits. Tests also verify that registration and profile updates cannot grant the admin role.

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

For an `encore_e2e_test` database that was fully migrated earlier but is now behind the repository (for example after pulling a new migration), the first `preflight` fails by design with "migration history does not match", because preflight accepts only an empty database or an exact match. In that case run `npx prisma migrate status --config prisma7.config.ts` and `npx prisma migrate deploy --config prisma7.config.ts` first (with the three URL variables set as above), then `preflight` and `fixtures`.

`npm run test:e2e` does **not** create or remove fixtures. Its `pretest:e2e` script runs only the read-only `preflight`. The Playwright configuration validates the URL variables and starts the backend and Vite, and the scenarios sign in as `E2E_ADMIN_EMAIL` and use `E2E_EVENT_ID`, which only `fixtures` creates. Run `fixtures` before the suite and `cleanup` after it. `fixtures` refuses to run unless every Encore table is empty, so after a failed or interrupted run, run `cleanup` before trying again rather than deleting rows by hand.

From `client/`, install Chromium once and run the suite:

```powershell
npx playwright install chromium
npm run test:e2e
```

Afterward, run `npm run e2e:database -- cleanup` from `server/`, even if the suite failed, to remove the records that run created: the administrator and `encore-e2e-<run id>.` customer accounts (the `.` ends the run ID exactly, so run `local` can never match run `local-m2-1`), the fixture events and events titled `Encore E2E <run id> …` (including events the scenarios create), their ticket types, and those accounts' reservations, bookings, idempotency keys, payment attempts, and linked webhook rows. Records belonging to other runs or other data are not selected. `fixtures` and `cleanup` apply the same environment-variable and URL-target checks as preflight and also query `current_database()` and `current_schema()` on their live connection, refusing to read or write unless it is `encore_e2e_test` / `public`; they do not re-check migration history. `fixtures` requires all ten Encore tables, including `event_poster_cleanups`, to be empty. `npm run test:e2e` runs preflight first through the `pretest:e2e` script; running `npx playwright test` directly skips that step but still validates the URL variables. CI's PostgreSQL service is disposable and is discarded with its job even if a test fails. E2E setup and cleanup never run against staging or production. The browser suite uses Vite's local `/api` proxy; it does not exercise Vercel's hosted rewrite itself. The existing Vercel rewrite unit test remains responsible for checking that configuration.
