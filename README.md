# Encore

**An Event Discovery and Ticket Booking Platform**

Encore is a full-stack web application inspired by event ticketing platforms such as Ticketmaster. It is designed to let users discover events, explore ticket types, reserve tickets, and manage their bookings.

The project focuses on full-stack development, backend architecture, database integrity, and the challenges of managing limited inventory when multiple users attempt to book tickets simultaneously.

## Project Goals

- Build an event discovery and ticket booking platform.
- Develop a full-stack application using React, Node.js, Express, and PostgreSQL.
- Design RESTful APIs and maintain a clear separation of backend responsibilities.
- Implement authentication and role-based authorization.
- Manage ticket inventory, reservations, and booking confirmation.
- Use database transactions and idempotency to maintain data consistency.
- Explore race conditions and concurrency through realistic ticket booking scenarios.
- Develop a maintainable application suitable for a software development portfolio.

## Technology Stack

### Frontend
- React
- Vite
- React Router

### Backend
- Node.js
- Express
- `pg` — PostgreSQL driver
- `dotenv` — environment variable management

### Database
- PostgreSQL 18

## Project Structure

```text
encore/
├── client/
│   ├── public/
│   ├── src/
│   └── package.json
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── validators/
│   │   ├── utils/
│   │   ├── app.js
│   │   └── server.js
│   └── package.json
├── tests/
├── .gitignore
└── README.md
```

The backend is organized into separate layers to keep HTTP handling, business logic, validation, and database access maintainable.

## Database Design

The PostgreSQL database is named `encore` and uses a relational schema consisting of seven tables.

| Table | Responsibility |
|---|---|
| `users` | Customer and administrator accounts |
| `events` | Event details and publication status |
| `ticket_types` | Ticket categories, prices, and inventory |
| `reservations` | Temporary ticket holds |
| `reservation_items` | Ticket quantities and reserved prices |
| `bookings` | Confirmed booking records |
| `idempotency_keys` | Support for safely retrying selected operations |

The schema uses UUID identifiers, foreign keys, unique constraints, and check constraints. Application-level validation and database transactions complement these constraints to maintain data integrity.

## Getting Started

### Prerequisites

- Node.js and npm
- PostgreSQL 18 or a compatible PostgreSQL installation
- Git

### 1. Install frontend dependencies

From the project root:

```bash
cd client
npm install
```

### 2. Install backend dependencies

Open a separate terminal:

```bash
cd server
npm install
```

### 3. Configure environment variables

Create a `server/.env` file with your local configuration:

```dotenv
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=encore
DB_USER=postgres
DB_PASSWORD=your_local_postgres_password

CLIENT_ORIGIN=http://localhost:5173
```

Replace the password placeholder with your local PostgreSQL password. Add authentication secrets as needed by the application.

Never commit actual credentials or secrets to version control.

### 4. Prepare the database

Create a PostgreSQL database named `encore` and apply the project's schema.

A reproducible schema or database migration workflow can be used to help other developers set up the database consistently.

### 5. Start the backend

From the `server/` directory:

```bash
npm start
```

The backend runs at:

`http://localhost:5000`

### 6. Start the frontend

From the `client/` directory:

```bash
npm run dev
```

Vite typically serves the frontend at:

`http://localhost:5173`

The React frontend communicates with the backend through HTTP APIs. It does not connect directly to PostgreSQL.

## API Overview

Encore's API is organized around event discovery, authentication, reservations, bookings, and administration.

### Health Check

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check API availability |

### Events

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/events` | List published events |
| GET | `/api/events/:eventId` | Retrieve event details and ticket types |

### Authentication

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register a customer |
| POST | `/api/auth/login` | Authenticate a customer |
| GET | `/api/auth/me` | Retrieve the authenticated user's profile |

### Reservations

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/reservations` | Create a temporary ticket reservation |
| GET | `/api/reservations/:reservationId` | Retrieve a reservation |
| POST | `/api/reservations/:reservationId/cancel` | Cancel a pending reservation |
| POST | `/api/reservations/:reservationId/checkout` | Initiate simulated checkout and booking confirmation |

### Bookings

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/bookings` | List the authenticated user's bookings |
| GET | `/api/bookings/:bookingId` | Retrieve a specific booking |

### Administration

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/admin/events` | Create an event |
| PATCH | `/api/admin/events/:eventId` | Update event details |
| PATCH | `/api/admin/events/:eventId/status` | Publish or cancel an event |
| POST | `/api/admin/events/:eventId/ticket-types` | Create ticket types |

## Backend Architecture

The backend follows a layered architecture:

- **Routes:** Map HTTP methods and paths to controller handlers.
- **Controllers:** Handle HTTP requests and responses.
- **Services:** Coordinate business rules and application workflows.
- **Models:** Encapsulate SQL queries and database access.
- **Middleware:** Handle shared request processing, authentication, authorization, and errors.
- **Validators:** Validate request parameters and payloads.
- **Utilities:** Provide reusable helpers and error-handling functionality.

The application uses PostgreSQL through `pg` and parameterized SQL rather than MongoDB or Mongoose.

## Engineering Concepts

### Database Transactions
Ensure related changes to reservations, ticket inventory, and bookings succeed or fail together when required.

### Inventory Management
Prevent overselling when multiple customers attempt to reserve the same tickets.

### Concurrency and Race Conditions
Explore atomic SQL updates, row locking, transaction isolation, and concurrent requests.

### Idempotency
Make supported retries safe so repeated requests do not unintentionally create duplicate bookings or repeat inventory changes.

### Security
Apply password hashing, authentication, authorization, request validation, and safe error handling.

### Testing
Use automated tests to examine normal operations, invalid requests, inventory limits, reservation cancellation, duplicate requests, and concurrent booking attempts.

## Learning Objective

Encore aims to demonstrate not only full-stack development skills, but also an understanding of how backend systems preserve correctness when multiple users compete for limited ticket inventory.
