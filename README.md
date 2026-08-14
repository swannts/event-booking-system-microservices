# Event Booking System Microservices

Event Booking System is a Node.js microservices monorepo for a technical assessment. It includes:

- `user-service`
- `event-service`
- `booking-service`
- `notification-service`
- PostgreSQL, Redis, and Kafka infrastructure

Docker Compose remains the local development path. Helm is the Kubernetes/Minikube deployment path.

## Local Development

Run the full stack with Docker Compose:

```bash
docker compose up --build
```

This keeps the local development flow separate from Kubernetes.

## Kubernetes Deployment

The Helm chart lives at:

`infrastructure/helm/event-booking`

Install it with Minikube values:

```bash
./scripts/minikube-start.sh
```

Or run Helm directly:

```bash
helm upgrade --install event-booking \
  infrastructure/helm/event-booking \
  -f infrastructure/helm/event-booking/values-minikube.yaml \
  --namespace event-booking \
  --create-namespace
```

### Values files

- `infrastructure/helm/event-booking/values.yaml`
- `infrastructure/helm/event-booking/values-minikube.yaml`

`values.yaml` contains the default chart settings. `values-minikube.yaml` switches the application images to local Minikube tags, lowers resource requests, and sets `imagePullPolicy: Never` for those local images.

### Minikube local images

The deployment script builds these images into Minikube’s Docker daemon:

- `event-booking/user-service:local`
- `event-booking/event-service:local`
- `event-booking/booking-service:local`
- `event-booking/notification-service:local`

Helm then deploys those images without trying to pull them from a registry.

### Inspect the release

```bash
helm list -n event-booking
kubectl get pods -n event-booking
kubectl get svc -n event-booking
kubectl get statefulsets -n event-booking
```

### Uninstall

```bash
helm uninstall event-booking -n event-booking
```

### Override values

Pass additional overrides with `--set` or another values file:

```bash
helm upgrade --install event-booking \
  infrastructure/helm/event-booking \
  -f infrastructure/helm/event-booking/values-minikube.yaml \
  --set global.logLevel=debug \
  --set eventService.cacheTtlSeconds=300
```

## Service Ports

- User Service: `3000`
- Event Service: `3001`
- Booking Service: `3002`
- Notification Service: `3003`
- Kafka: `9092`
- Redis: `6379`
- PostgreSQL: `5432`

## Kubernetes Service DNS Names

When installed as `event-booking` in the `event-booking` namespace, the chart generates these internal service names:

- `event-booking-user-service.event-booking.svc.cluster.local`
- `event-booking-event-service.event-booking.svc.cluster.local`
- `event-booking-booking-service.event-booking.svc.cluster.local`
- `event-booking-notification-service.event-booking.svc.cluster.local`
- `event-booking-event-db.event-booking.svc.cluster.local`
- `event-booking-booking-db.event-booking.svc.cluster.local`
- `event-booking-redis.event-booking.svc.cluster.local`
- `event-booking-kafka.event-booking.svc.cluster.local`

## Database Ownership

Each service owns its own data boundary.

- User Service uses its own PostgreSQL database (`user-db`).
- Event Service uses its own PostgreSQL database (`event-db`).
- Booking Service uses its own PostgreSQL database (`booking-db`).
- Notification Service consumes Kafka events and logs/stores notifications.

No service reads another service’s database directly.

## Postman Collection

A complete Postman collection is provided for testing all microservice APIs:

File: [`docs/Event_Booking_System.postman_collection.json`](file:///home/swann/PhpstormProjects/event-booking-system-microservices/docs/Event_Booking_System.postman_collection.json)

### Importing into Postman:
1. Open Postman.
2. Click **Import** in the upper left.
3. Select `docs/Event_Booking_System.postman_collection.json`.
4. Run requests against User, Event, Booking, and Notification services.

## Bonus Features

- **Redis-based API Rate Limiting**: Built-in sliding window rate limiter in `services/event-service/src/middleware/rate-limiter.ts` returning standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`).
- **Health Checks**: `/health/live` and `/health/ready` endpoints across all microservices.
- **Rolling Deployment**: Kubernetes deployments use rolling update strategies for zero-downtime updates.

## Port Forward Examples

Use port-forwarding if you want to access services from your workstation:

```bash
kubectl -n event-booking port-forward svc/event-booking-user-service 3000:3000
kubectl -n event-booking port-forward svc/event-booking-event-service 3001:3001
kubectl -n event-booking port-forward svc/event-booking-booking-service 3002:3002
kubectl -n event-booking port-forward svc/event-booking-notification-service 3003:3003
```

## Deployment Scripts

- `scripts/minikube-start.sh` starts Minikube and then deploys the Helm release.
- `scripts/minikube-deploy.sh` builds local images, installs or upgrades the Helm release, waits for workloads, and prints release/pod/service status.

## Notes

- The chart uses placeholder local/demo credentials for the assessment.
- Helm values control the non-sensitive configuration, while database URLs and credentials are stored in a Kubernetes Secret.
- Docker Compose is still the local development path. Helm is the Kubernetes deployment mechanism for this assessment.
