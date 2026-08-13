#!/usr/bin/env bash
set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-minikube}"

minikube start -p "${PROFILE}" --driver=docker
bash "$(dirname "${BASH_SOURCE[0]}")/minikube-deploy.sh"
