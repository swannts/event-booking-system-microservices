#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${MINIKUBE_PROFILE:-minikube}"
NAMESPACE="event-booking"
RELEASE_NAME="event-booking"
CHART_DIR="${ROOT_DIR}/infrastructure/helm/event-booking"

if ! minikube status -p "${PROFILE}" >/dev/null 2>&1; then
  echo "Minikube profile '${PROFILE}' is not running. Start it with scripts/minikube-start.sh first." >&2
  exit 1
fi

eval "$(minikube -p "${PROFILE}" docker-env)"

docker build -t event-booking/user-service:local -f "${ROOT_DIR}/services/user-service/Dockerfile" "${ROOT_DIR}"
docker build -t event-booking/event-service:local -f "${ROOT_DIR}/services/event-service/Dockerfile" "${ROOT_DIR}"
docker build -t event-booking/booking-service:local -f "${ROOT_DIR}/services/booking-service/Dockerfile" "${ROOT_DIR}"
docker build -t event-booking/notification-service:local -f "${ROOT_DIR}/services/notification-service/Dockerfile" "${ROOT_DIR}"

helm upgrade --install "${RELEASE_NAME}" "${CHART_DIR}" \
  -f "${CHART_DIR}/values-minikube.yaml" \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  --wait \
  --timeout 10m

kubectl -n "${NAMESPACE}" rollout status deployment/event-booking-user-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/event-booking-event-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/event-booking-booking-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/event-booking-notification-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status statefulset/event-booking-event-db --timeout=300s
kubectl -n "${NAMESPACE}" rollout status statefulset/event-booking-booking-db --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/event-booking-redis --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/event-booking-kafka --timeout=300s

helm list -n "${NAMESPACE}"

kubectl -n "${NAMESPACE}" get pods -o wide
kubectl -n "${NAMESPACE}" get services -o wide
kubectl -n "${NAMESPACE}" get statefulsets -o wide

echo ""
echo "=== Starting Port Forwarding for Local API & Postman Testing ==="
pkill -f "kubectl.*port-forward.*${NAMESPACE}" || true

kubectl -n "${NAMESPACE}" port-forward svc/event-booking-user-service 3000:3000 >/dev/null 2>&1 &
kubectl -n "${NAMESPACE}" port-forward svc/event-booking-event-service 3001:3001 >/dev/null 2>&1 &
kubectl -n "${NAMESPACE}" port-forward svc/event-booking-booking-service 3002:3002 >/dev/null 2>&1 &
kubectl -n "${NAMESPACE}" port-forward svc/event-booking-notification-service 3003:3003 >/dev/null 2>&1 &

sleep 2

echo "Port forwarding active:"
echo "  - User Service:         http://localhost:3000"
echo "  - Event Service:        http://localhost:3001"
echo "  - Booking Service:      http://localhost:3002"
echo "  - Notification Service: http://localhost:3003"
echo "Ready for Postman API testing!"

