#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${MINIKUBE_PROFILE:-minikube}"
NAMESPACE="event-booking"

if ! minikube status -p "${PROFILE}" >/dev/null 2>&1; then
  echo "Minikube profile '${PROFILE}' is not running. Start it with scripts/minikube-start.sh first." >&2
  exit 1
fi

eval "$(minikube -p "${PROFILE}" docker-env)"

docker build -t event-booking/user-service:local -f "${ROOT_DIR}/services/user-service/Dockerfile" "${ROOT_DIR}"
docker build -t event-booking/event-service:local -f "${ROOT_DIR}/services/event-service/Dockerfile" "${ROOT_DIR}"
docker build -t event-booking/booking-service:local -f "${ROOT_DIR}/services/booking-service/Dockerfile" "${ROOT_DIR}"
docker build -t event-booking/notification-service:local -f "${ROOT_DIR}/services/notification-service/Dockerfile" "${ROOT_DIR}"

kubectl apply -k "${ROOT_DIR}/infrastructure/kubernetes/overlays/minikube"

kubectl -n "${NAMESPACE}" rollout status deployment/user-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/event-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/booking-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/notification-service --timeout=300s
kubectl -n "${NAMESPACE}" rollout status statefulset/event-db --timeout=300s
kubectl -n "${NAMESPACE}" rollout status statefulset/booking-db --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/redis --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/kafka --timeout=300s

kubectl -n "${NAMESPACE}" get pods -o wide
kubectl -n "${NAMESPACE}" get services -o wide
