# Backend testing

Encore uses Node.js's built-in `node:test` runner. It works with the project's Node.js 24 CommonJS backend and needs no additional test dependencies. Tests live in the repository-level `tests/` directory so the project has one shared test location.

## Test suites

- `tests/unit/` exercises request validation, reservation price serialization, the test-database safety guard, and the public error response without connecting to PostgreSQL.
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

Create a separate empty PostgreSQL database named `encore_test` using your local PostgreSQL administration tool. Do not use the normal `encore` development database. The integration suite checks that all seven tables are empty before it starts; if a prior interrupted run left data behind, it fails without deleting those rows. Because this repository has no migration history, prepare the dedicated database explicitly from `server/` by pointing Prisma at the test database and applying the current Prisma model:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://<user>:<url-encoded-password>@localhost:5432/encore_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npx prisma db push --config prisma7.config.ts
npm run test:integration
```

Alternatively, put only the `TEST_DATABASE_URL` setting in an ignored `server/.env.test` file and run `npm run test:integration`. The test helper sets `DATABASE_URL` to the same explicit test URL before loading the application. A normal development database named `encore` is rejected by the safety guard. Never put real credentials in tracked documentation or `.env.example`.

`db push` is a manual, explicit setup step and is not run by any test command. Confirm the URL points at the dedicated test database before running it. Integration tests make no schema changes and never run resets, truncations, migrations, or broad cleanup.

## Fixtures, cleanup, and concurrency

The integration suite creates uniquely named users and event fixtures. It tracks their IDs and removes only those records, deleting bookings and reservation items before their parent rows to respect foreign keys. No seed data is required. The suite uses the same application, services, Prisma singleton, adapter, and PostgreSQL transactions as the backend.

For inventory and checkout race tests, two HTTP operations wait at a shared in-process barrier and are released together. The tests then inspect PostgreSQL to assert final inventory and booking counts; they do not mock transactions or rely on sleeps. Integration test files are run one at a time to keep their cleanup isolated.

The current tests cover registration and login, session/profile/logout behavior, public events, reservation validation and ownership, inventory decrement/restoration, expiration/cancellation races, final-ticket contention, checkout totals and rollback, idempotency-key validation and replay, same-key and different-key checkout races, failed-checkout retries, cross-user isolation, booking ownership, admin authorization, and admin event management. Admin HTTP tests check unauthenticated (`401`) and customer (`403`) access, verify role revocation, exercise event creation/editing and draft/published visibility, reject invalid and past-date payloads, and confirm event edits preserve ticket inventory and reservation items. An unchanged past date on a legacy event does not block unrelated edits. They also verify that registration and profile updates cannot grant the admin role. Ticket-type management remains unimplemented.

Run the admin security integration coverage with `npm run test:integration` from `server/`, using only the dedicated empty PostgreSQL database configured through `TEST_DATABASE_URL` as described above. To provision a real administrator, first create an account through public registration, verify the `DATABASE_URL` in `server/.env` points to the intended local database, then run `npm run admin:promote -- owner@example.com` from `server/`. The command promotes only the explicitly supplied existing account; it is never part of startup, seed, or test setup.
