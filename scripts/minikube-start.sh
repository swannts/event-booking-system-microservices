#!/usr/bin/env bash
set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-minikube}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

minikube start -p "${PROFILE}" --driver=docker
"${ROOT_DIR}/scripts/minikube-deploy.sh"
