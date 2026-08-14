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
RELEASE_NAME="event-booking-${ENV}"
CHART_DIR="${ROOT_DIR}/infrastructure/helm/event-booking"
VALUES_FILE="${CHART_DIR}/values-${ENV}.yaml"

if [ ! -f "${VALUES_FILE}" ]; then
  echo "Values file ${VALUES_FILE} does not exist!" >&2
  exit 1
fi

echo "=================================================="
echo " Deploying via Helm [Environment: ${ENV}]"
echo " Namespace: ${NAMESPACE}"
echo " Release:   ${RELEASE_NAME}"
echo " Values:    ${VALUES_FILE}"
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

echo "Upgrading Helm release '${RELEASE_NAME}'..."
helm upgrade --install "${RELEASE_NAME}" "${CHART_DIR}" \
  -f "${CHART_DIR}/values.yaml" \
  -f "${VALUES_FILE}" \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  --wait \
  --timeout 10m

echo "Deployment finished. Resource Status for ${NAMESPACE}:"
kubectl -n "${NAMESPACE}" get pods -o wide
kubectl -n "${NAMESPACE}" get services -o wide
