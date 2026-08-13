# Minikube Deployment Notes

This repository uses Kustomize manifests under `infrastructure/kubernetes/overlays/minikube`.

The services are exposed internally through `ClusterIP` services:

- `user-service:3000`
- `event-service:3001`
- `booking-service:3002`
- `notification-service:3003`
- `event-db:5432`
- `booking-db:5432`
- `redis:6379`
- `kafka:9092`

For local access from your machine, use port-forwarding:

```bash
kubectl -n event-booking port-forward svc/user-service 3000:3000
kubectl -n event-booking port-forward svc/event-service 3001:3001
kubectl -n event-booking port-forward svc/booking-service 3002:3002
kubectl -n event-booking port-forward svc/notification-service 3003:3003
```

Kafka and Redis are intended for in-cluster access only.
