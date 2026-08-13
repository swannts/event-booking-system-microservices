# Architecture

## Service Boundaries

- User Service owns users and user validation.
- Event Service will own events, available seat counts, and Redis cache.
- Booking Service will own booking requests, status transitions, and idempotency.
- Notification Service will consume booking events and log or send notifications.

## Shared Contracts

Shared Kafka topics and message envelopes live in `packages/contracts`.

## Current Implementation

The repository currently contains a verified User Service implementation plus scaffolding for the remaining services.

## Next Phases

1. Event CRUD and seat inventory
2. Redis cache-aside for event reads
3. Booking creation and Kafka messaging
4. Notification consumption
5. Docker and Kubernetes wiring
