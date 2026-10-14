# Encore

**An Event Discovery and Ticket Booking Platform**

Encore is a full-stack web application inspired by event ticketing platforms such as Ticketmaster. It is designed to let users discover events, explore ticket types, reserve tickets, and manage their bookings.

This personal portfolio project focuses on full-stack development, backend architecture, relational database design, and the challenges of managing limited ticket inventory when multiple users attempt to book tickets simultaneously.

The long-term goal is to build a complete booking workflow while exploring database transactions, idempotency, concurrency, and race conditions.

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

- **React** — component-based user interface
- **Vite** — frontend development server and build tooling
- **React Router** — client-side routing

### Backend

- **Node.js** — JavaScript runtime
- **Express 5** — REST API and HTTP request handling
- **Prisma ORM 7** — database client and structured data access
- **`@prisma/adapter-pg`** — PostgreSQL driver adapter for Prisma
- **dotenv** — environment variable management

### Database

- **PostgreSQL 18** — relational database for users, events, ticket inventory, reservations, and bookings

### Development Tools

- **Git and GitHub** — version control, remote repository hosting, and feature-based development
- **Prisma CLI** — schema validation, database introspection, and client generation

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
- **Middleware** handles shared request processing, authentication, authorization, and errors.
- **Validators** validate request parameters and payloads.
- **Utilities** provide reusable helpers and error-handling functionality.

The Express application uses CommonJS, while Prisma 7's generated client uses ES modules. The Prisma client is initialized lazily and shared through a singleton, allowing the application to initialize database access when needed.

## Project Structure

```text
encore-app/
├── client/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── App.css
│   └── package.json
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.js
│   ├── src/
│   │   ├── config/
│   │   │   └── prisma.js
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
│   ├── unit/
│   └── integration/
├── .gitignore
└── README.md
```

## Database Design

Encore uses PostgreSQL with a relational schema consisting of seven tables.

| Table | Responsibility |
|---|---|
| `users` | Customer and administrator accounts |
| `events` | Event details and publication status |
| `ticket_types` | Ticket categories, prices, and inventory |
| `reservations` | Temporary ticket holds and reservation status |
| `reservation_items` | Ticket quantities and reserved prices |
| `bookings` | Confirmed booking records |
| `idempotency_keys` | Information used to safely retry supported operations |

The schema uses UUID identifiers, foreign keys, unique constraints, database defaults, and check constraints to protect data integrity.

Prisma provides the application with a structured way to query and work with relational data. Its schema represents the existing PostgreSQL tables, while PostgreSQL remains responsible for enforcing database-level constraints, including check constraints that Prisma does not fully represent in its generated client.

## Getting Started

### Prerequisites

- Node.js and npm
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

Create a local `server/.env` file using `server/.env.example` as a reference. The backend and Prisma 7 use `DATABASE_URL` as the single PostgreSQL connection setting. Local development expects PostgreSQL on port `5432` and a database named `encore`.

The required environment variables are:

- `DATABASE_URL` — PostgreSQL connection URL used by Prisma 7.
- `JWT_SECRET` — session signing secret that must be at least 32 bytes long.

The following variables are optional:

- `JWT_EXPIRES_IN` — session lifetime; defaults to `1d`.
- `FRONTEND_ORIGIN` — accepted frontend Origin for authentication changes; defaults to `http://localhost:5173`.
- `NODE_ENV` — controls the Secure session-cookie flag in production.
- `VITE_API_BASE_URL` — optional frontend API base URL.

The backend listens on port `5000`, PostgreSQL uses port `5432`, and the Vite frontend typically uses port `5173`.

The frontend does not need a local environment file for the default Vite proxy. When `VITE_API_BASE_URL` is unset or blank, the frontend uses relative `/api` requests, which Vite proxies to the Express backend.

If your database password contains reserved URL characters, URL-encode those characters in `DATABASE_URL`.

Never commit actual credentials or secrets to version control.

### 5. Prepare the database and Prisma Client

Create the `encore` database in PostgreSQL.

For an existing database, Prisma can introspect the current schema and generate a client from it. From the `server/` directory, run:

```bash
npx prisma validate --config prisma7.config.ts
npx prisma db pull --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

`db pull` updates the local Prisma schema based on the connected database; it does not apply schema changes to PostgreSQL. Confirm that the connection points to the intended database before running database commands.

### 6. Start the backend

From `server/`:

```bash
npm start
```

The API runs at:

`http://localhost:5000`

The health endpoint is available at:

`http://localhost:5000/api/health`

### 7. Start the frontend

From `client/`:

```bash
npm run dev
```

Vite typically serves the application at:

`http://localhost:5173`

The Vite development server proxies `/api` requests to the Express backend.

## API Overview

Encore's REST API is organized into separate resource groups for health checks, event discovery, authentication, reservations, bookings, and administration.

### Health API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Check whether the API is running |

### Event APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events` | Retrieve published events |
| GET | `/api/events/:eventId` | Retrieve a published event and its ticket types |

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
| POST | `/api/reservations/:reservationId/checkout` | Confirm a simulated checkout and create a booking (authenticated; requires `Idempotency-Key`) |

Reservation holds expire after 15 minutes. Expired holds are processed when relevant event or reservation endpoints are accessed; a separate background worker is not currently configured.

Checkout requires an `Idempotency-Key` header containing 8–255 ASCII letters, numbers, dots, underscores, tildes, or hyphens. The key is scoped to the authenticated user and checkout operation. Retrying the same key for the same reservation replays the original successful status and response body; using it for a different reservation returns HTTP 409. The client generates one UUID per checkout attempt and retains it in session storage until it receives a successful response, so it can recover if the server committed but the response was lost. The key and saved response commit in the same PostgreSQL transaction as the booking. Failed checkout attempts do not consume a key.

### Booking APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/bookings` | List the authenticated customer's bookings |
| GET | `/api/bookings/:bookingId` | Retrieve one booking owned by the authenticated customer |

### Administration APIs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/admin/events` | Placeholder; event creation is not implemented yet |
| PATCH | `/api/admin/events/:eventId` | Placeholder; event updates are not implemented yet |
| PATCH | `/api/admin/events/:eventId/status` | Placeholder; event status updates are not implemented yet |
| POST | `/api/admin/events/:eventId/ticket-types` | Placeholder; ticket-type creation is not implemented yet |

Booking routes require authentication and return only the signed-in customer's records. Administration routes are not protected by authorization middleware yet and should not be treated as secure, usable workflows.

Successful implemented API responses generally use a JSON structure with a `success` field and a `data` or `message` field, as appropriate. Placeholder endpoints may return a not-implemented response instead.

## Engineering Concepts

### Database Transactions

Keep related changes to reservations, ticket inventory, and bookings consistent by committing them together or rolling them back when necessary.

### Inventory Management

Prevent overselling when multiple customers attempt to reserve the same tickets.

### Concurrency and Race Conditions

Explore atomic updates, row locking, transaction isolation, and simultaneous requests to understand how competing operations affect shared inventory.

### Idempotency

Make supported retries safe so repeated requests do not unintentionally create duplicate bookings or apply the same inventory change more than once.

### Security

Apply password hashing, authentication, role-based authorization, request validation, and safe error handling.

### Testing

Test successful requests, invalid inputs, missing records, inventory limits, reservation cancellation and expiration, duplicate requests, and concurrent booking attempts.

See [tests/README.md](tests/README.md) for the automated test commands, dedicated PostgreSQL test database setup, and fixture cleanup behavior.

## Development Workflow

Encore is developed incrementally using Git feature branches to keep changes organized.

The workflow is:

1. Create a feature branch from the updated `main` branch.
2. Implement and test the feature locally.
3. Commit related changes with descriptive commit messages.
4. Push the branch to GitHub.
5. Open a pull request to review the changes.
6. Merge the feature into `main` after verification.

This workflow keeps the main branch organized and makes it easier to review changes, isolate bugs, and maintain a clear project history.

## Learning Objective

Encore is intended to demonstrate more than the ability to build a full-stack CRUD application. Its primary learning objective is to develop a practical understanding of how a backend system maintains data integrity and reliability when multiple users compete for limited resources.
