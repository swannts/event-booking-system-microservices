# Booking load tests

The k6 test creates a user and a limited-capacity event, submits concurrent one-seat bookings, waits for Kafka processing, and verifies:

```text
confirmed booked quantity + available seats = total seats
```

It reports k6's request count, request rate, failure rate, and latency distribution, including p50, p95, and p99. It also emits `booking_requests_total`, `booking_success_rate`, and `booking_failure_rate`.

## Prerequisites

Start the complete application and install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/):

```bash
docker compose up -d --build
pnpm test:load:smoke
```

## Profiles

Fast smoke profile for CI or local validation:

```bash
pnpm test:load:smoke
```

Overselling profile: 250 concurrent attempts against 100 seats:

```bash
pnpm test:load
```

Configurable overselling run:

```bash
PROFILE=oversell VUS=300 ITERATIONS=500 CAPACITY=100 DURATION=2m pnpm test:load
```

Duration-based steady load:

```bash
PROFILE=steady VUS=25 DURATION=2m CAPACITY=1000 pnpm test:load
```

Service URLs and the asynchronous settle timeout are configurable with `USER_SERVICE_URL`, `EVENT_SERVICE_URL`, `BOOKING_SERVICE_URL`, and `SETTLE_TIMEOUT_MS`.

The repository does not contain benchmark numbers. Run results depend on the machine, container runtime, and selected profile.
