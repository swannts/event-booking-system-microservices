#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-dev}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${MINIKUBE_PROFILE:-minikube}"

case "${ENV}" in
  dev|staging|prod) ;;
  *)
    echo "Usage: $0 [dev|staging|prod]" >&2
    exit 1
    ;;
esac

NAMESPACE="event-booking-${ENV}"
OVERLAY_DIR="${ROOT_DIR}/infrastructure/kustomize/overlays/${ENV}"

if [ ! -d "${OVERLAY_DIR}" ]; then
  echo "Overlay directory ${OVERLAY_DIR} does not exist!" >&2
  exit 1
fi

echo "=================================================="
echo " Deploying via Kustomize [Environment: ${ENV}]"
echo " Namespace:   ${NAMESPACE}"
echo " Overlay Dir: ${OVERLAY_DIR}"
echo "=================================================="

if minikube status -p "${PROFILE}" >/dev/null 2>&1; then
  echo "Minikube profile '${PROFILE}' detected. Using minikube docker-env..."
  eval "$(minikube -p "${PROFILE}" docker-env)"
fi

IMAGE_TAG="${ENV}"
if [ "${ENV}" = "prod" ]; then
  IMAGE_TAG="v1.0.0"
fi

echo "Building Docker images with tag: ${IMAGE_TAG}..."
docker build -t "event-booking/user-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/user-service/Dockerfile" "${ROOT_DIR}"
docker build -t "event-booking/event-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/event-service/Dockerfile" "${ROOT_DIR}"
docker build -t "event-booking/booking-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/booking-service/Dockerfile" "${ROOT_DIR}"
docker build -t "event-booking/notification-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/notification-service/Dockerfile" "${ROOT_DIR}"

echo "Creating namespace '${NAMESPACE}' if not exists..."
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "Applying Kustomize overlay..."
kubectl apply -k "${OVERLAY_DIR}"

echo "Waiting for deployments to roll out..."
kubectl -n "${NAMESPACE}" rollout status deployment/user-service --timeout=300s || true
kubectl -n "${NAMESPACE}" rollout status deployment/event-service --timeout=300s || true
kubectl -n "${NAMESPACE}" rollout status deployment/booking-service --timeout=300s || true
kubectl -n "${NAMESPACE}" rollout status deployment/notification-service --timeout=300s || true

echo "Deployment finished. Resource Status for ${NAMESPACE}:"
kubectl -n "${NAMESPACE}" get pods -o wide
kubectl -n "${NAMESPACE}" get services -o wide
