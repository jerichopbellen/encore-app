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
- **`pg`** — PostgreSQL driver
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
- **Services** coordinate application logic and business rules.
- **Models** organize database access through Prisma.
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
│   │   └── schema.prisma
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

Create a local `server/.env` file using `server/.env.example` as a reference. The backend and Prisma 7 use `DATABASE_URL` as the single PostgreSQL connection setting; local development expects PostgreSQL on port `5432` and the database named `encore`.

`JWT_SECRET` is required and must be a random value at least 32 bytes long. `JWT_EXPIRES_IN` optionally sets the session lifetime (default `1d`), `FRONTEND_ORIGIN` optionally sets the browser Origin accepted for authentication changes (default `http://localhost:5173`), and `NODE_ENV=production` enables the Secure session cookie flag. The backend listens on port `5000`; the Vite frontend uses port `5173` and proxies `/api` to the backend.

The frontend does not need a local environment file with the default Vite proxy. Its optional `VITE_API_BASE_URL` setting is documented in `client/.env.example`; leave it empty for local development. If you set a database password containing reserved URL characters, URL-encode those characters in `DATABASE_URL`.

Never commit actual credentials or secrets to version control.

### 5. Prepare the database and Prisma Client

Create the `encore` database and prepare its tables using the project's database schema.

For an existing database, Prisma can introspect the current schema and generate a client from it. From the `server/` directory, run:

```bash
npx prisma validate --config prisma7.config.ts
npx prisma db pull --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

`db pull` updates the local Prisma schema based on the connected database; it does not apply schema changes to PostgreSQL. Confirm the connection points to the intended database before running database commands.

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

### Reservation APIs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/reservations` | Create a ticket reservation |
| GET | `/api/reservations/:reservationId` | Retrieve a reservation |
| POST | `/api/reservations/:reservationId/cancel` | Cancel a reservation |
| POST | `/api/reservations/:reservationId/checkout` | Initiate checkout for a reservation |

### Booking APIs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/bookings` | Retrieve bookings |
| GET | `/api/bookings/:bookingId` | Retrieve a specific booking |

### Administration APIs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/admin/events` | Create an event |
| PATCH | `/api/admin/events/:eventId` | Update event details |
| PATCH | `/api/admin/events/:eventId/status` | Update an event's status |
| POST | `/api/admin/events/:eventId/ticket-types` | Create ticket types |

These tables document the API's route organization. Individual workflows may require further implementation, authentication, authorization, and testing before they are ready for use.

Successful API responses use a consistent JSON structure with a `success` field and a `data` or `message` field, as appropriate.

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
