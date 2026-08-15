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
BASE_IMAGE="node:22-alpine"

host_docker() {
  env -u DOCKER_HOST -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH -u DOCKER_CONTEXT docker "$@"
}

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
  echo "Minikube profile '${PROFILE}' detected."
fi

if ! docker image inspect "${BASE_IMAGE}" >/dev/null 2>&1; then
  echo "Base image ${BASE_IMAGE} is not present in the active Docker daemon."
  if minikube status -p "${PROFILE}" >/dev/null 2>&1; then
    echo "Trying host Docker and loading the image into the active Minikube daemon..."
    if host_docker pull "${BASE_IMAGE}" && host_docker save "${BASE_IMAGE}" | docker load >/dev/null; then
      echo "Loaded ${BASE_IMAGE} into the active Docker daemon."
    else
      cat >&2 <<EOF
Unable to make ${BASE_IMAGE} available in the active Docker daemon.
The Minikube daemon could not reach Docker Hub, and the host Docker daemon could not provide the image either.
If you are using Minikube, make sure Docker Hub is reachable from the host Docker daemon, then rerun:
  eval "\$(minikube -p \"${PROFILE}\" docker-env)"
  docker pull ${BASE_IMAGE}
EOF
      exit 1
    fi
  else
    echo "Pulling ${BASE_IMAGE} from Docker Hub..."
    if ! docker pull "${BASE_IMAGE}"; then
      cat >&2 <<EOF
Unable to pull ${BASE_IMAGE} in the active Docker daemon.
Make sure Docker Hub is reachable or pre-load the base image before rerunning the deploy.
EOF
      exit 1
    fi
  fi
fi

IMAGE_TAG="${ENV}"
if [ "${ENV}" = "prod" ]; then
  IMAGE_TAG="v1.0.0"
fi

echo "Building Docker images with tag: ${IMAGE_TAG}..."
if minikube status -p "${PROFILE}" >/dev/null 2>&1; then
  echo "Building on host Docker daemon and loading into Minikube cluster '${PROFILE}'..."
  host_docker build -t "event-booking/user-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/user-service/Dockerfile" "${ROOT_DIR}"
  host_docker build -t "event-booking/event-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/event-service/Dockerfile" "${ROOT_DIR}"
  host_docker build -t "event-booking/booking-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/booking-service/Dockerfile" "${ROOT_DIR}"
  host_docker build -t "event-booking/notification-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/notification-service/Dockerfile" "${ROOT_DIR}"

  echo "Loading images into Minikube cluster '${PROFILE}'..."
  minikube -p "${PROFILE}" image load "event-booking/user-service:${IMAGE_TAG}"
  minikube -p "${PROFILE}" image load "event-booking/event-service:${IMAGE_TAG}"
  minikube -p "${PROFILE}" image load "event-booking/booking-service:${IMAGE_TAG}"
  minikube -p "${PROFILE}" image load "event-booking/notification-service:${IMAGE_TAG}"

  unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_CONTEXT MINIKUBE_ACTIVE_DOCKER_MD5
else
  docker build -t "event-booking/user-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/user-service/Dockerfile" "${ROOT_DIR}"
  docker build -t "event-booking/event-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/event-service/Dockerfile" "${ROOT_DIR}"
  docker build -t "event-booking/booking-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/booking-service/Dockerfile" "${ROOT_DIR}"
  docker build -t "event-booking/notification-service:${IMAGE_TAG}" -f "${ROOT_DIR}/services/notification-service/Dockerfile" "${ROOT_DIR}"
fi

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

echo ""
echo "=== Starting Port Forwarding for Local API & Postman Testing (${NAMESPACE}) ==="
pkill -f "kubectl.*port-forward.*${NAMESPACE}" || true

kubectl -n "${NAMESPACE}" port-forward "svc/${RELEASE_NAME}-user-service" 3000:3000 >/dev/null 2>&1 &
kubectl -n "${NAMESPACE}" port-forward "svc/${RELEASE_NAME}-event-service" 3001:3001 >/dev/null 2>&1 &
kubectl -n "${NAMESPACE}" port-forward "svc/${RELEASE_NAME}-booking-service" 3002:3002 >/dev/null 2>&1 &
kubectl -n "${NAMESPACE}" port-forward "svc/${RELEASE_NAME}-notification-service" 3003:3003 >/dev/null 2>&1 &

sleep 2

echo "Port forwarding active for namespace ${NAMESPACE}:"
echo "  - User Service:         http://localhost:3000"
echo "  - Event Service:        http://localhost:3001"
echo "  - Booking Service:      http://localhost:3002"
echo "  - Notification Service: http://localhost:3003"

