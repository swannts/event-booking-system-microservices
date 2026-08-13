# Event Booking System Microservices

Monorepo scaffold for an event booking system built with Node.js, TypeScript, Express, PostgreSQL-compatible SQL, Redis, Kafka, Docker, and Kubernetes.

## Current Status

- Workspace scaffolded with `pnpm` workspaces
- Shared contracts package created
- User service implemented with validation, health checks, and tests
- Event, booking, and notification services are scaffolded for the next phase

## Quick Start

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

## Services

- `services/user-service`
- `services/event-service`
- `services/booking-service`
- `services/notification-service`

## Architecture

See [docs/architecture.md](docs/architecture.md).

## User Service

Implemented endpoints:

- `POST /users`
- `GET /users/:id`
- `GET /users`
- `GET /health/live`
- `GET /health/ready`

Validation:

- name required
- email required
- valid email format
- duplicate email rejected

## Notes

This repository is being built incrementally. The first vertical slice is complete and verified, and the remaining services will follow the same pattern.
