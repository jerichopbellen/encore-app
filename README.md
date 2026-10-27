# Encore

**An Event Discovery and Ticket Booking Platform**

Encore is a full-stack web application inspired by event ticketing platforms such as Ticketmaster. Customers can discover events, explore ticket types, reserve tickets, pay, and manage their bookings. Administrators can manage events, posters, and ticket inventory.

This personal portfolio project focuses on full-stack development, backend architecture, relational database design, and the challenges of managing limited ticket inventory when multiple users attempt to book tickets simultaneously.


## Project Goals

- Build a complete event discovery and ticket booking platform.
- Develop a full-stack application with a React frontend and a Node.js backend.
- Design RESTful APIs with a clear separation of responsibilities.
- Use an ORM to model relational data and simplify database access.
- Implement authentication and role-based authorization.
- Manage ticket inventory, reservations, and booking confirmation.
- Use database transactions and idempotency to maintain data consistency.
- Explore race conditions and concurrency through realistic ticket-booking scenarios.
- Build a maintainable application that demonstrates practical software engineering skills.

## Technology Stack

### Frontend

- **React 19** — component-based user interface
- **Vite** — frontend development server and build tooling
- **React Router** — client-side routing
- **ESLint** — frontend linting
- **Playwright** — browser end-to-end tests

### Backend

- **Node.js 24** — JavaScript runtime
- **Express 5** — REST API and HTTP request handling
- **Prisma ORM 7** — database client and structured data access
- **`@prisma/adapter-pg`** — PostgreSQL driver adapter for Prisma
- **bcrypt** and **jsonwebtoken** — password hashing and signed session tokens (HTTP-only cookies)
- **Stripe Node SDK** — optional Stripe-hosted Checkout in test mode
- **Cloudinary Node SDK** — optional server-side storage for admin-uploaded event posters
- **dotenv** — environment variable management

### Database

- **PostgreSQL 18** — relational database for users, events, ticket inventory, reservations, bookings, and payments

### Development and Deployment Tools

- **Git and GitHub** — version control, feature-branch development, and pull requests
- **GitHub Actions** — CI and the staging release workflow
- **Prisma CLI** — schema validation, migrations, and client generation
- **Vercel** (frontend), **Render** (API), **Neon** (PostgreSQL) — staging deployment targets

## Architecture

Encore separates the frontend, API, application logic, and database access into distinct layers.

```text
React Frontend
      |
      | HTTP / REST API
      v
Express Routes
      |
      v
Controllers
      |
      v
Services
      |
      v
Prisma Client
      |
      | PostgreSQL driver adapter
      v
PostgreSQL Database
```

The frontend communicates with the backend through HTTP requests and does not connect directly to PostgreSQL.

The backend uses a layered architecture:

- **Routes** map HTTP methods and paths to controller handlers.
- **Controllers** handle incoming requests and construct HTTP responses.
- **Services** coordinate application logic, business rules, and Prisma database queries.
- **Gateways** (`stripeGateway`, `cloudinaryGateway`) wrap third-party SDK calls so they can be replaced in tests.
- **Middleware** handles CORS, same-origin checks on unsafe requests, authentication, authorization, request logging, poster upload parsing, and errors.
- **Validators** validate request parameters and payloads.
- **Config and utilities** provide environment validation, payment and poster configuration, structured logging, and error helpers.

The Express application uses CommonJS, while Prisma 7's generated client uses ES modules. The Prisma client is initialized lazily and shared through a singleton, allowing the application to initialize database access when needed.

PostgreSQL is the authority for inventory, reservations, and booking correctness. The frontend never acts as concurrency protection.

## Project Structure

```text
encore-app/
├── .github/workflows/        # CI and staging release workflows
├── client/
│   ├── e2e/                  # Playwright browser tests
│   ├── public/
│   ├── src/
│   │   ├── components/       # admin, auth, events, layout
│   │   ├── contexts/         # AuthContext
│   │   ├── hooks/
│   │   ├── pages/            # account, admin, auth, bookings, checkout, events, profile, reservations
│   │   ├── services/         # API client modules
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── App.css
│   ├── vercel.json
│   └── package.json
├── server/
│   ├── prisma/
│   │   ├── migrations/       # Reviewed SQL migrations
│   │   ├── schema.prisma
│   │   └── seed.js
│   ├── scripts/              # admin:promote, posters:cleanup, E2E database helper
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── validators/
│   │   ├── app.js
│   │   └── server.js
│   ├── prisma7.config.ts
│   ├── .env.example
│   └── package.json
├── tests/
│   ├── helpers/
│   ├── unit/
│   ├── integration/
│   └── run.cjs
├── DEPLOYMENT.md
├── render.yaml
├── .gitignore
└── README.md
```

## Database Design

Encore uses PostgreSQL with a relational schema consisting of ten tables.

| Table | Responsibility |
|---|---|
| `users` | Customer and administrator accounts |
| `events` | Event details, publication status, and optional poster reference |
| `ticket_types` | Ticket categories, prices, and inventory |
| `reservations` | Temporary ticket holds and reservation status |
| `reservation_items` | Ticket quantities and reserved prices |
| `bookings` | Confirmed booking records |
| `idempotency_keys` | Information used to safely retry supported operations |
| `payment_attempts` | One row per attempt to pay for a reservation through Stripe-hosted Checkout |
| `stripe_webhook_events` | Durable deduplication of processed Stripe webhook deliveries |
| `event_poster_cleanups` | Cloudinary poster assets waiting to be deleted after a replacement, removal, or failed upload |

The schema uses UUID identifiers, foreign keys, unique constraints, partial unique indexes, database defaults, and check constraints to protect data integrity. Schema changes are tracked as reviewed SQL migrations in `server/prisma/migrations/`.

Prisma provides the application with a structured way to query and work with relational data. PostgreSQL remains responsible for enforcing database-level constraints, including check constraints and partial indexes that Prisma does not fully represent in its generated client.

## Getting Started

### Prerequisites

- Node.js 24 and npm
- PostgreSQL 18 or a compatible PostgreSQL installation
- Git

### 1. Clone the repository

```bash
git clone https://github.com/jerichopbellen/encore-app.git
cd encore-app
```

### 2. Install frontend dependencies

From the project root:

```bash
cd client
npm install
```

### 3. Install backend dependencies

Open another terminal from the project root:

```bash
cd server
npm install
```

### 4. Configure environment variables

Create a local `server/.env` file using `server/.env.example` as a reference. The API uses `DATABASE_URL` through the existing Prisma PostgreSQL adapter. `DIRECT_DATABASE_URL` is optional locally and is intended for direct Prisma CLI/migration connections. Local development expects PostgreSQL on port `5432` and a database named `encore`.

The required environment variables are:

- `DATABASE_URL` — PostgreSQL connection URL used by Prisma 7.
- `JWT_SECRET` — session signing secret that must be at least 32 bytes long.

The following variables are optional:

- `DIRECT_DATABASE_URL` — direct database connection for Prisma CLI operations; defaults to `DATABASE_URL` when unset.
- `TEST_DATABASE_URL` — dedicated database for integration tests; its name must contain `test` (see [tests/README.md](tests/README.md)).
- `JWT_EXPIRES_IN` — session lifetime; defaults to `1d`.
- `FRONTEND_ORIGIN` — exact allowed browser origin for CORS and API mutations; defaults to `http://localhost:5173`.
- `COOKIE_SAME_SITE` — cookie policy; defaults to `lax` and `none` is restricted to production HTTPS.
- `PORT` — backend listener port; defaults to `5000` locally and is supplied by Render in production.
- `NODE_ENV` — controls secure cookies and production startup validation.
- `PAYMENT_PROVIDER` — `simulated` (default) or `stripe`. With `stripe`, `STRIPE_SECRET_KEY` (test-mode `sk_test_...` only) and `STRIPE_WEBHOOK_SECRET` (`whsec_...`) are also required, and simulated checkout is rejected by the API.
- `VITE_API_BASE_URL` — optional frontend API base URL.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — optional, set together to enable admin poster uploads (server-only).
- `CLOUDINARY_POSTER_FOLDER` — Cloudinary Media Library folder and public ID prefix for posters; defaults to `encore/event-posters`.
- `POSTER_UPLOAD_MAX_BYTES` — maximum poster size; defaults to 4 MB (4194304 bytes), at most 10 MB.

The backend defaults to port `5000`, PostgreSQL uses port `5432`, and the Vite frontend typically uses port `5173`.

The frontend does not need a local environment file for the default Vite proxy. When `VITE_API_BASE_URL` is unset or blank, the frontend uses relative `/api` requests, which Vite proxies to the Express backend.

If your database password contains reserved URL characters, URL-encode those characters in `DATABASE_URL`.

Never commit actual credentials or secrets to version control.

### 5. Prepare the database and Prisma Client

Create the `encore` database in PostgreSQL. The repository includes reviewed migrations that build the full schema on a new empty database. From `server/`, apply them and generate the client:

```bash
npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

Confirm that `DATABASE_URL` and `DIRECT_DATABASE_URL` point to the intended database before running database commands. A development database created before migrations were introduced has no migration history and must be baselined first; deployment, baselining, and test setup are described in [DEPLOYMENT.md](DEPLOYMENT.md).

Optional sample data can be loaded with `npm run db:seed` from `server/`.

### 6. Start the backend

From `server/`:

```bash
npm start
```

The API runs at:

`http://localhost:5000`

The health endpoint is available at:

`http://localhost:5000/api/health`

A readiness endpoint that also checks the database is available at `http://localhost:5000/api/ready`.

### 7. Start the frontend

From `client/`:

```bash
npm run dev
```

Vite typically serves the application at:

`http://localhost:5173`

The Vite development server proxies `/api` requests to the Express backend.

### Provision the first administrator

First create the account through the normal registration flow. From `server/`, verify that `DATABASE_URL` in your local `server/.env` points to the intended database, then promote that exact existing account:

```powershell
npm run admin:promote -- owner@example.com
```

The command changes only that user's `role` field. It does not create an account, set a password, or run automatically during startup or seeding. It fails if the email is invalid or no matching account exists. Keep database access and the command restricted to a trusted operator.

### Useful commands

| Where | Command | Purpose |
|---|---|---|
| `server/` | `npm start` | Start the API |
| `server/` | `npm test` | Unit tests (no database needed) |
| `server/` | `npm run test:integration` | PostgreSQL integration tests (requires `TEST_DATABASE_URL`) |
| `server/` | `npm run test:all` | Both suites |
| `server/` | `npm run db:seed` | Load sample data |
| `server/` | `npm run admin:promote -- <email>` | Promote an existing account to administrator |
| `server/` | `npm run posters:cleanup` | Retry deletion of orphaned Cloudinary posters |
| `client/` | `npm run dev` | Start the Vite dev server |
| `client/` | `npm run lint` | Lint the frontend |
| `client/` | `npm run build` | Production build |
| `client/` | `npm run test:e2e` | Playwright browser tests (isolated E2E database) |

## Frontend Routes

| Path | Description |
|---|---|
| `/` | Discover events (search, availability filter, sort, pagination) |
| `/events/:id` | Event details, ticket types, and reservation panel |
| `/login`, `/register` | Authentication |
| `/account/profile`, `/account/reservations`, `/account/bookings` | Authenticated account area with a shared layout; `/account` opens the profile section |
| `/reservations/:reservationId/checkout` | Checkout for a pending reservation |
| `/reservations/:reservationId/payment/return` | Return page after Stripe-hosted Checkout; it only reads what Encore has recorded |
| `/bookings/:bookingId` | Booking confirmation |
| `/admin`, `/admin/events`, `/admin/events/new`, `/admin/events/:eventId` | Administrator dashboard and event management (admin-only) |

The former `/profile`, `/reservations`, and `/bookings` list URLs redirect to their matching account sections so existing links keep working.

## API Overview

Encore's REST API is organized into resource groups for health checks, event discovery, authentication, reservations, payments, bookings, and administration.

### Health APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Check whether the API is running |
| GET | `/api/ready` | Check whether the API can reach the database |

### Event APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events` | Retrieve a page of published events, optionally searched, filtered, and sorted |
| GET | `/api/events/:eventId` | Retrieve a published event and its ticket types |

`GET /api/events` accepts `page` (default `1`), `page_size` (default `12`, maximum `48`), `q` (up to 100 characters; case-insensitive match against title or venue), `available` (`true` to include only events with available tickets), and `sort` (`soonest`, `latest`, or `recently-added`; defaults to `soonest`). These options combine, and each new search or filter starts on page one in the client. Results contain `data.events` and `data.pagination` (`page`, `page_size`, `total_events`, and `total_pages`). Only published events that have not started are listed in Discover. Results use deterministic ordering with event ID as a tie-breaker. Category and price filters are not offered because those fields are not represented as event catalogue attributes in the current schema.

Events that have started cannot be reserved or checked out, but their public details, ticket information, and existing booking history remain accessible.

### Authentication APIs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a customer |
| POST | `/api/auth/login` | Authenticate a customer |
| GET | `/api/auth/me` | Retrieve the current user's profile |
| PATCH | `/api/auth/me` | Update the current user's name |
| POST | `/api/auth/logout` | End the current session |

### Reservation APIs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/reservations` | Create a ticket reservation (authenticated) |
| GET | `/api/reservations` | List the current user's reservations (authenticated) |
| GET | `/api/reservations/:reservationId` | Retrieve one of the current user's reservations (authenticated) |
| POST | `/api/reservations/:reservationId/cancel` | Cancel a pending reservation (authenticated) |
| POST | `/api/reservations/:reservationId/checkout` | Confirm a simulated checkout and create a booking (authenticated; requires `Idempotency-Key`; simulated mode only) |

Reservation holds expire after 15 minutes. Expired holds are processed when relevant event or reservation endpoints are accessed; a separate background worker is not currently configured.

Simulated checkout requires an `Idempotency-Key` header containing 8–255 ASCII letters, numbers, dots, underscores, tildes, or hyphens. The key is scoped to the authenticated user and checkout operation. Retrying the same key for the same reservation replays the original successful status and response body; using it for a different reservation returns HTTP 409. The client generates one UUID per checkout attempt and retains it in session storage until it receives a successful response, so it can recover if the server committed but the response was lost. The key and saved response commit in the same PostgreSQL transaction as the booking. Failed checkout attempts do not consume a key.

### Payment APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/payments/config` | Public, secret-free; tells the UI whether to offer simulated or Stripe checkout |
| POST | `/api/reservations/:reservationId/payments` | Start a Stripe-hosted Checkout Session for a reservation (authenticated) |
| POST | `/api/reservations/:reservationId/payments/cancel` | Cancel the open payment attempt for a reservation (authenticated) |
| GET | `/api/reservations/:reservationId/payments/latest` | Retrieve the latest payment attempt for a reservation (authenticated) |
| POST | `/api/payments/stripe/webhook` | Receive signed Stripe webhook events (authenticated by signature, not session) |

Payments run in one of two modes, chosen by `PAYMENT_PROVIDER`:

- **`simulated` (default):** no charge is made; checkout confirms the reservation directly.
- **`stripe`:** Stripe-hosted Checkout in **test mode only**. The server prices the payment from the reservation, and **a booking is created only by a verified webhook**. The browser's return from Stripe never creates a booking. The booking, the payment attempt update, and the webhook deduplication row are written in one transaction, so repeated deliveries cannot create duplicate bookings. Payments Encore cannot fulfil (late, cancelled or expired reservation, event already started, unexpected amount or session) are stored as `needs_review` instead of being fulfilled.

The raw-body webhook route is registered before `express.json()` so Stripe's signature can be verified against the exact bytes it sent. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full Stripe restrictions, including mode-switching rules and webhook recovery.

### Booking APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/bookings` | List the authenticated customer's bookings |
| GET | `/api/bookings/:bookingId` | Retrieve one booking owned by the authenticated customer |

### Administration APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/dashboard` | Retrieve event, inventory, reservation, booking, and upcoming-event overview metrics (administrator only) |
| GET | `/api/admin/events` | Retrieve all events, including drafts, with upcoming/past timing (administrator only) |
| POST | `/api/admin/events` | Create an event as a draft (administrator only) |
| PATCH | `/api/admin/events/:eventId` | Update event title, description, venue, or start time (administrator only) |
| PATCH | `/api/admin/events/:eventId/status` | Publish or return an event to draft (administrator only) |
| POST | `/api/admin/events/:eventId/poster?expected_poster=<id or none>` | Upload or replace the event's custom poster; the body is the raw JPEG, PNG, or WebP file (administrator only) |
| DELETE | `/api/admin/events/:eventId/poster?expected_poster=<id or none>` | Remove the custom poster and restore the default generated poster (administrator only) |
| GET | `/api/admin/events/:eventId/ticket-types` | List ticket types for an event (administrator only) |
| POST | `/api/admin/events/:eventId/ticket-types` | Create a ticket type (administrator only) |
| PATCH | `/api/admin/events/:eventId/ticket-types/:ticketTypeId` | Update a ticket type's name, price, or total capacity (administrator only) |

Booking routes require authentication and return only the signed-in customer's records. The `/api/admin` route group first requires a valid session (HTTP `401` when missing or invalid), then checks the authenticated user's current database role (HTTP `403` for non-admin users). The role is loaded from PostgreSQL for each authenticated request, so changing an account back to `customer` revokes admin access even for an existing session. Public registration always creates a customer, and profile updates only change the name.

Admin event routes require the current database role to be `admin`. Creating an event leaves it in the schema's default `draft` status. The status endpoint accepts only `draft` and `published`; the public catalogue and event details continue to show published events only. Event updates allow only the title, description, venue, and start time, preserving related ticket types, reservations, and inventory. Ticket type names are unique within their event; prices must be positive and use at most two decimal places. Capacity is a non-negative whole number. Reducing capacity below active reservation holds and confirmed bookings returns HTTP `409` and leaves the requested capacity unchanged.

The admin dashboard is available to administrators at `/admin`. The response includes `event_counts` (`total` includes every event row; `published` and `draft` count their matching statuses), `ticket_inventory` (ticket type row count, sum of configured capacity, and sum of the database's current `available_quantity`), `reservation_counts`, `confirmed_booking_count`, and `upcoming_events`.

Reservation counts include active pending holds (`status = pending` and `expires_at` is later than the snapshot time), `pending_expired` holds (still marked pending but with `expires_at` at or before that time), and rows marked `cancelled`, `expired`, or `confirmed`; `other` and `total` account for other stored statuses and all reservation rows. Confirmed bookings count only rows with `status = confirmed`. The upcoming list contains at most five published events whose start time is at or after the snapshot time, in chronological order. All values are read from one repeatable-read database snapshot. The endpoint does not process expired reservations or change inventory; stored available inventory may therefore remain reduced until an existing reservation workflow handles an expired hold. Ticket type management remains within each event in the admin events page. Dashboard metrics do not include customer identity or revenue.

Ticket inventory uses `available_quantity = total_quantity - committed_quantity`, where committed quantity is the sum of unexpired pending reservation items and items in confirmed bookings. Updating capacity locks the relevant PostgreSQL ticket row before recalculating this value. Reservation creation takes an atomic conditional update lock on that same row; cancellation and expiry acquire it before changing reservation status and restoring inventory. This makes those operations serialize around ticket inventory without changing the saved prices on existing reservation items. Expired pending holds are excluded after the existing expiry process marks them expired.

Event posters are optional. Event responses include `poster_url` (`null` when the event has no custom poster, in which case the frontend draws Encore's generated poster); admin responses also include `poster_public_id`. Uploads are sent as the raw request body with an image `Content-Type`, limited by `POSTER_UPLOAD_MAX_BYTES` (HTTP `413` when larger), and checked by their leading bytes: only JPEG, PNG, and WebP are accepted, so SVG and other active content is rejected (HTTP `415`). The API stores the image in Cloudinary under a new public ID, verifies Cloudinary's response, and only then points the event at it inside a transaction that locks the event row. `expected_poster` must name the poster the admin is looking at (`none` for the default); if the event's poster changed in the meantime, the request returns HTTP `409` and changes nothing. The previous asset is deleted from Cloudinary only after that transaction commits; a deletion that fails stays recorded in `event_poster_cleanups` and is retried by later poster changes or by `npm run posters:cleanup`. Poster changes never touch ticket types, inventory, reservations, bookings, or payments. When the Cloudinary variables are not configured, uploads return HTTP `503` and every event keeps its default poster.

Successful implemented API responses generally use a JSON structure with a `success` field and a `data` or `message` field, as appropriate.

## Engineering Concepts

### Database Transactions

Related changes to reservations, ticket inventory, bookings, and payment records are committed together or rolled back when necessary.

### Inventory Management

Reservation creation, cancellation, expiry, and capacity changes all serialize around the PostgreSQL ticket row, preventing overselling when multiple customers attempt to reserve the same tickets.

### Concurrency and Race Conditions

Atomic conditional updates, row locking, transaction isolation, and consistent lock ordering protect shared inventory. Integration tests release competing HTTP requests together at a barrier and then inspect the database to verify the outcome.

### Idempotency

Checkout retries are safe: the same key replays the original result instead of creating a duplicate booking. Stripe webhook deliveries are deduplicated in a durable table written in the same transaction as the booking.

### Security

Passwords are hashed with bcrypt and sessions use signed, HTTP-only cookies. Admin authorization is enforced server-side using the current database role. Unsafe requests are checked against the exact allowed origin, request payloads are validated, uploads are verified by content, Stripe webhooks are verified by signature, and errors are returned without leaking internals.

### Testing

Unit, PostgreSQL integration, and browser tests cover successful requests, invalid inputs, missing records, inventory limits, reservation cancellation and expiration, duplicate requests, concurrent booking attempts, payment lifecycles, and poster handling. Integration tests run only against a dedicated, guarded test database and never against the development database.

See [tests/README.md](tests/README.md) for the automated test commands, dedicated PostgreSQL test database setup, and fixture cleanup behavior.

## Continuous Integration and Deployment

- **CI** (`.github/workflows/ci.yml`) runs on pull requests to `main`. It runs backend unit tests, validates the Prisma schema, applies migrations to a disposable PostgreSQL 18 service, runs the integration suite, lints and builds the frontend, and then runs Playwright browser tests against a separate disposable database.
- **Staging release** (`.github/workflows/staging-release.yml`) runs on pushes to `main`. It reuses CI, applies pending migrations to the staging database, and triggers a Render deployment.
- **Hosting:** the React frontend is built by Vercel, which also rewrites `/api` to the Render-hosted Express API so browser requests stay same-origin. PostgreSQL is hosted on Neon.

See [DEPLOYMENT.md](DEPLOYMENT.md) for provider configuration, the Prisma migration workflow, Stripe test-mode restrictions, and the staging verification checklist. No provider resources are created automatically by this repository.

## Development Workflow

Encore is developed incrementally using Git feature branches to keep changes organized.

The workflow is:

1. Create a feature branch from the updated `main` branch.
2. Implement and test the feature locally.
3. Commit related changes with descriptive commit messages.
4. Push the branch to GitHub.
5. Open a pull request; CI must pass.
6. Merge the feature into `main` after verification, which triggers the staging release.

This workflow keeps the main branch organized and makes it easier to review changes, isolate bugs, and maintain a clear project history.

## Learning Objective

Encore is intended to demonstrate more than the ability to build a full-stack CRUD application. Its primary learning objective is to develop a practical understanding of how a backend system maintains data integrity and reliability when multiple users compete for limited resources.
