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

## Fixtures, cleanup, and concurrency

The integration suite creates uniquely named users and event fixtures. It tracks their IDs and removes only those records, deleting bookings and reservation items before their parent rows to respect foreign keys. No seed data is required. The suite uses the same application, services, Prisma singleton, adapter, and PostgreSQL transactions as the backend.

For inventory and checkout race tests, two HTTP operations wait at a shared in-process barrier and are released together. The tests then inspect PostgreSQL to assert final inventory and booking counts; they do not mock transactions or rely on sleeps. Event-cutoff race tests hold a PostgreSQL lock from a separate connection and, in one query, confirm that exactly one application backend is blocked at the marked statement while database time is still before the event start, then release the lock after the cutoff. Integration test files are run one at a time to keep their cleanup isolated.

The current tests cover registration and login, session/profile/logout behavior, public event visibility and catalogue query validation, search, availability filtering, stable paginated results and filtered counts, reservation validation and ownership, inventory decrement/restoration, expiration/cancellation races, final-ticket contention, checkout totals and rollback, idempotency-key validation and replay, same-key and different-key checkout races, failed-checkout retries, cross-user isolation, booking ownership, admin authorization, dashboard metric aggregation and zero states, and admin event management. Past and exactly-at-cutoff published events are excluded from Discover and cannot be reserved or checked out; their public details, ticket information, admin visibility, and existing booking history remain accessible. Admin HTTP tests check unauthenticated (`401`) and customer (`403`) access, verify role revocation, exercise event creation/editing and draft/published visibility, reject invalid and past-date payloads, confirm dashboard counts and upcoming-event filtering, and verify dashboard reads do not change ticket inventory. Ticket-type coverage verifies authorization, CRUD validation, duplicate names, saved reservation prices, committed inventory protection, and concurrent reservation/capacity changes. An unchanged past date on a legacy event does not block unrelated edits. Tests also verify that registration and profile updates cannot grant the admin role.

Run the admin security integration coverage with `npm run test:integration` from `server/`, using only the dedicated empty PostgreSQL database configured through `TEST_DATABASE_URL` as described above. To provision a real administrator, first create an account through public registration, verify the `DATABASE_URL` in `server/.env` points to the intended local database, then run `npm run admin:promote -- owner@example.com` from `server/`. The command promotes only the explicitly supplied existing account; it is never part of startup, seed, or test setup.

## Browser E2E tests

Encore's Playwright suite lives in `client/e2e/` because it drives the React application in a real browser. From `client/`, `npm run test:e2e` runs the six sequential Chromium scenarios. The Playwright config starts the backend with `npm start` and the Vite development server, and refuses to reuse already-running servers so a stale API cannot accidentally be tested. Vite proxies browser `/api` requests to that backend.

The suite requires a separate disposable PostgreSQL database named exactly `encore_e2e_test`, on `localhost` or `127.0.0.1`, with the `public` schema. Before migrations, `npm run e2e:database -- preflight` checks that `TEST_DATABASE_URL`, `DATABASE_URL`, and `DIRECT_DATABASE_URL` are all explicitly set to the same local E2E URL and that the database has no tables. It reuses the integration suite's PostgreSQL URL/name validator and adds the stricter database-name and loopback-host checks. The CI job supplies all three URLs explicitly, applies only the checked-in migrations to its separate ephemeral PostgreSQL service, then checks the Encore tables are empty before creating fixtures.

For local E2E execution, install backend and frontend packages with `npm ci` from `server/` and `client/`, then prepare a fresh local PostgreSQL database named `encore_e2e_test`; do not point these variables to the development, integration-test, staging, or production database. In PowerShell, set all three variables to the exact same URL and provide test-only values:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://<local-user>:<url-encoded-password>@localhost:5432/encore_e2e_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_DATABASE_URL = $env:TEST_DATABASE_URL
$env:E2E_RUN_ID = 'local-run-1'
$env:E2E_ADMIN_EMAIL = 'encore-e2e-local-run-1@example.test'
$env:E2E_ADMIN_PASSWORD = 'a-test-only-password-longer-than-12'
$env:E2E_EVENT_ID = 'a2000000-0000-4000-8000-000000000001'
```

Then, from `server/`, validate and prepare only that disposable database:

```powershell
npm run e2e:database -- preflight
npx prisma migrate deploy --config prisma7.config.ts
npm run e2e:database -- fixtures
```

From `client/`, install Chromium once and run the suite:

```powershell
npx playwright install chromium
npm run test:e2e
```

Afterward, run `npm run e2e:database -- cleanup` from `server/` to remove only the E2E administrator, customer accounts, event, ticket types, reservations, and bookings created by that run. The script checks the same strict local database target before cleanup. CI's PostgreSQL service is disposable and is discarded with its job even if a test fails. E2E setup and cleanup never run against staging or production. The browser suite uses Vite's local `/api` proxy; it does not exercise Vercel's hosted rewrite itself. The existing Vercel rewrite unit test remains responsible for checking that configuration.
