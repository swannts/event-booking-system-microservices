# Event Booking System Microservices

Node.js microservices monorepo for an event booking system. The current implementation includes:

- `user-service` for user CRUD
- `event-service` for event CRUD, Redis cache-aside reads, and atomic seat reservation/release
- `booking-service` for booking creation, idempotency, state transitions, and outbox publishing
- `notification-service` for consuming booking lifecycle events and exposing stored notifications
- shared packages for Kafka contracts, logging, messaging, and test utilities
- Docker Compose and Helm-based deployment paths

See [`docs/architecture.md`](docs/architecture.md) for the detailed flow and tradeoffs.

## Repository Layout

- `services/user-service` - user API and PostgreSQL persistence
- `services/event-service` - event API, inventory, Redis cache, Kafka consumers/producers
- `services/booking-service` - booking API, idempotent create/cancel flow, outbox processing
- `services/notification-service` - notification consumer and read API
- `packages/contracts` - shared Kafka message contracts and enums
- `packages/logger` - shared structured logging
- `packages/messaging` - shared Kafka client wrappers
- `packages/test-utils` - shared test helpers
- `infrastructure/helm/event-booking` - Helm chart used by the deployment scripts
- `infrastructure/legacy-kustomize` - legacy manifests kept for reference only
- `scripts` - deployment and Minikube helpers
- `docs/Event_Booking_System.postman_collection.json` - Postman collection for manual API testing

## Tech Stack

- Node.js 22
- TypeScript
- Express
- Prisma
- PostgreSQL
- Redis
- Kafka in KRaft mode
- Docker Compose
- Helm and Minikube
- Vitest and Supertest

## Prerequisites

- Node.js 22
- `corepack` enabled
- Docker and Docker Compose
- Helm 3
- Minikube for the Kubernetes path
- Docker must be able to pull `node:22-alpine` from Docker Hub when building images, or that base image must already exist in the active Docker daemon

## Install

```bash
corepack pnpm install --frozen-lockfile
```

## Build And Test

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm typecheck
corepack pnpm test:e2e
```

The root scripts run the workspace packages in dependency order. `test` builds first, then runs the service test suites.

## Local Development With Docker Compose

Run the full stack locally:

```bash
docker compose up --build
```

The compose file starts:

- `user-db`
- `event-db`
- `booking-db`
- `redis`
- `kafka`
- `user-service`
- `event-service`
- `booking-service`
- `notification-service`

Each service has a health endpoint at `/health/live` and `/health/ready`. The service containers run Prisma migrations through one-shot migration containers before the app containers start.

For a clean E2E run:

```bash
docker compose down -v --remove-orphans
corepack pnpm test:e2e
```

## Deployment

The main deployment entrypoint is [`scripts/deploy.sh`](scripts/deploy.sh).

Usage:

```bash
./scripts/deploy.sh [helm|kustomize] [dev|staging|prod]
```

Defaults:

- tool: `helm`
- environment: `dev`

### Deployment Tools & Environments

1. **Helm Path (`scripts/deploy-helm.sh`)**:
   - Deploys the Helm chart located in `infrastructure/helm/event-booking`.
   - Uses `values.yaml` plus environment overlay (`values-dev.yaml`, `values-staging.yaml`, or `values-prod.yaml`).
   - Target namespace: `event-booking-${ENV}`.

2. **Kustomize Path (`scripts/deploy-kustomize.sh`)**:
   - Deploys Kustomize manifests located in `infrastructure/legacy-kustomize/overlays/${ENV}`.
   - Target namespace: `event-booking-${ENV}`.

### Usage Examples:

```bash
# Helm deployments
./scripts/deploy.sh helm dev
./scripts/deploy.sh helm staging
./scripts/deploy.sh helm prod

# Kustomize deployments
./scripts/deploy.sh kustomize dev
./scripts/deploy.sh kustomize staging
./scripts/deploy.sh kustomize prod
```

Notes:

- `prod` uses the `v1.0.0` image tag in the deployment scripts.
- The deploy scripts ensure `node:22-alpine` is available before building. In Minikube mode, images are built using the host Docker daemon and loaded directly into the active Minikube cluster via `minikube image load`.

### Minikube Flow

This starts the configured Minikube profile if needed, builds local service images, and deploys the Helm release with `values-minikube.yaml`.

The Minikube deploy script also waits for the main workloads and starts local port-forwards:

- `http://localhost:3000` - user service
- `http://localhost:3001` - event service
- `http://localhost:3002` - booking service
- `http://localhost:3003` - notification service

## Service APIs

| Service      | Method | Path                               |
| ------------ | ------ | ---------------------------------- |
| User         | POST   | `/users`                           |
| User         | GET    | `/users`                           |
| User         | GET    | `/users/:id`                       |
| Event        | POST   | `/events`                          |
| Event        | GET    | `/events`                          |
| Event        | GET    | `/events/:id`                      |
| Event        | PUT    | `/events/:id`                      |
| Event        | DELETE | `/events/:id`                      |
| Booking      | POST   | `/bookings`                        |
| Booking      | GET    | `/bookings/:id`                    |
| Booking      | GET    | `/bookings/users/:userId/bookings` |
| Booking      | POST   | `/bookings/:id/cancel`             |
| Notification | GET    | `/notifications`                   |

The booking create endpoint supports the `Idempotency-Key` header.

## Event Flow

1. Booking Service publishes `booking.reserve-seats`.
2. Event Service consumes the reservation request and applies an atomic seat update.
3. Event Service publishes `event.seats-reserved` or `event.seat-reservation-failed`.
4. Booking Service consumes the outcome and transitions the booking to `CONFIRMED` or `FAILED`.
5. Booking Service publishes `booking.confirmed`, `booking.failed`, or `booking.cancelled`.
6. Notification Service consumes booking lifecycle events and records notifications for demo visibility.

## Redis Caching

- Event Service uses Redis as cache-aside storage for event reads.
- Cache keys follow the `event:{eventId}` pattern.
- Reads populate Redis on cache misses.
- Updates, deletes, reservations, and releases invalidate the cached event.

## Data Ownership

- User Service uses PostgreSQL
- Event Service uses PostgreSQL and Redis
- Booking Service uses PostgreSQL
- Notification Service keeps notifications in memory for the demo flow

No service reads another service's database directly.

## Postman Collection

Import [`docs/Event_Booking_System.postman_collection.json`](docs/Event_Booking_System.postman_collection.json) into Postman to exercise the HTTP APIs manually.
