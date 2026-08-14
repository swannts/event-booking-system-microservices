# Event Booking System Microservices

Event Booking System is a Node.js microservices monorepo built for a 5-day technical assessment.

## Architecture

- `user-service` handles user CRUD and uses PostgreSQL.
- `event-service` handles event CRUD, Redis cache-aside reads, seat reservation, and seat release.
- `booking-service` creates bookings, owns booking state transitions, and publishes booking lifecycle events.
- `notification-service` consumes booking lifecycle events and stores notification records for demo visibility.
- Kafka links the services asynchronously.
- Redis is used by the event service only.

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

## Project Structure

- `services/user-service` - user API and PostgreSQL persistence
- `services/event-service` - event API, inventory, Redis cache, Kafka consumers/producers
- `services/booking-service` - booking API, inbox/outbox processing, cancellation flow
- `services/notification-service` - notification consumer and read API
- `packages/contracts` - shared Kafka message contracts and enums
- `packages/logger` - shared structured logging
- `packages/messaging` - shared Kafka client wrappers
- `infrastructure/helm/event-booking` - Helm chart for Minikube/Kubernetes
- `docs/Event_Booking_System.postman_collection.json` - Postman collection
- `tests/e2e` - Docker Compose E2E flow

## Prerequisites

- Node.js 22
- `corepack` enabled
- Docker and Docker Compose
- Helm 3
- Minikube for the Kubernetes path

## Local Development

Run the full stack with Docker Compose:

```bash
docker compose up --build
```

The compose stack now runs Prisma migrations through one-shot migration services before the application containers start.

## Docker Compose

The local compose stack includes:

- `user-db`
- `event-db`
- `booking-db`
- `redis`
- `kafka`
- `user-service`
- `event-service`
- `booking-service`
- `notification-service`

Fresh-volume E2E runs use:

```bash
docker compose down -v --remove-orphans
pnpm test:e2e
```

## Database Migrations

Prisma migrations are the source of truth for the database schema.

- User Service migration: `services/user-service/prisma/migrations`
- Event Service migration: `services/event-service/prisma/migrations`
- Booking Service migration: `services/booking-service/prisma/migrations`

Useful commands:

```bash
corepack pnpm --dir services/user-service prisma:migrate:deploy
corepack pnpm --dir services/event-service prisma:migrate:deploy
corepack pnpm --dir services/booking-service prisma:migrate:deploy
```

## Minikube Deployment Using Helm

Helm chart location:

`infrastructure/helm/event-booking`

Recommended Minikube flow:

```bash
./scripts/minikube-start.sh
```

Or deploy directly:

```bash
helm upgrade --install event-booking \
  infrastructure/helm/event-booking \
  -f infrastructure/helm/event-booking/values-minikube.yaml \
  --namespace event-booking \
  --create-namespace
```

`values.yaml` contains the default chart settings. `values-minikube.yaml` switches the application images to local Minikube tags, reduces resource requests, and sets `imagePullPolicy: Never` for the local images.

### Helm lifecycle

```bash
helm list -n event-booking
helm upgrade --install event-booking infrastructure/helm/event-booking \
  -f infrastructure/helm/event-booking/values-minikube.yaml \
  --namespace event-booking \
  --create-namespace
helm uninstall event-booking -n event-booking
```

### Minikube local images

The Minikube deploy script builds these images into Minikube’s Docker daemon:

- `event-booking/user-service:local`
- `event-booking/event-service:local`
- `event-booking/booking-service:local`
- `event-booking/notification-service:local`

That lets Kubernetes start the local images without pulling from a registry.

### Port forwarding

```bash
kubectl -n event-booking port-forward svc/event-booking-user-service 3000:3000
kubectl -n event-booking port-forward svc/event-booking-event-service 3001:3001
kubectl -n event-booking port-forward svc/event-booking-booking-service 3002:3002
kubectl -n event-booking port-forward svc/event-booking-notification-service 3003:3003
```

### Override values

```bash
helm upgrade --install event-booking \
  infrastructure/helm/event-booking \
  -f infrastructure/helm/event-booking/values-minikube.yaml \
  --set global.logLevel=debug \
  --set eventService.cacheTtlSeconds=300
```

## API Endpoint Table

| Service | Method | Path |
| --- | --- | --- |
| User | POST | `/users` |
| User | GET | `/users` |
| User | GET | `/users/:id` |
| Event | POST | `/events` |
| Event | GET | `/events` |
| Event | GET | `/events/:id` |
| Event | PUT | `/events/:id` |
| Event | DELETE | `/events/:id` |
| Booking | POST | `/bookings` |
| Booking | GET | `/bookings/:id` |
| Booking | GET | `/bookings/users/:userId/bookings` |
| Booking | POST | `/bookings/:id/cancel` |
| Notification | GET | `/notifications` |

The booking create endpoint supports the `Idempotency-Key` header.

## Redis Caching Behavior

- Event Service uses Redis as cache-aside storage for event reads.
- Cache keys follow the `event:{eventId}` pattern.
- Reads populate Redis on cache misses.
- Updates, deletes, reservations, and releases invalidate the cached event.

## Kafka Event Flow

1. Booking Service publishes `booking.reserve-seats`.
2. Event Service reserves seats and publishes `event.seats-reserved` or `event.seat-reservation-failed`.
3. Booking Service consumes the event outcome, updates booking state, and publishes `booking.confirmed` or `booking.failed`.
4. Booking cancellation publishes `booking.cancelled`.
5. Event Service consumes `booking.cancelled` and releases seats.
6. Notification Service consumes booking lifecycle events and stores notification records.

## Race-Condition Prevention

- Event Service updates seat inventory with conditional SQL inside a transaction.
- Booking Service uses atomic state transitions for booking confirmation, failure, and cancellation.
- Inbox rows prevent duplicate Kafka deliveries from applying twice.
- Outbox rows ensure durable event publication after the database commit.

## Running Tests

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

The event-service concurrency test and the compose E2E suite are included in the validation flow.

## Postman Collection

Import `docs/Event_Booking_System.postman_collection.json` into Postman to exercise:

- create/list/get users
- create/list/update/delete events
- create booking with `Idempotency-Key`
- get booking
- list bookings for a user
- cancel booking
- list notifications
- health checks

## Health Endpoints

Each service exposes:

- `GET /health/live`
- `GET /health/ready`

## Bonus Features

- Redis-backed rate limiting on Event Service routes
- Redis cache-aside for event reads
- Kafka-based asynchronous booking lifecycle processing
- Transactional inbox and outbox handling

## Production Considerations

- Kafka is intentionally configured as a single broker for the assessment.
- Authentication is outside the assessment scope.
- Notification persistence is lightweight and could be replaced with durable storage in production.
- Production hardening can add richer observability, security, and multi-broker resilience later.
