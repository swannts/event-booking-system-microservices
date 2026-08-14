#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${MINIKUBE_PROFILE:-minikube}"

if ! minikube status -p "${PROFILE}" >/dev/null 2>&1; then
  minikube start -p "${PROFILE}"
fi

"${ROOT_DIR}/scripts/minikube-deploy.sh"
