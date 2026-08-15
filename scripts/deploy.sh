#!/usr/bin/env bash
set -euo pipefail

TOOL="${1:-helm}"
ENV="${2:-dev}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${TOOL}" in
  helm)
    "${ROOT_DIR}/scripts/deploy-helm.sh" "${ENV}"
    ;;
  kustomize)
    "${ROOT_DIR}/scripts/deploy-kustomize.sh" "${ENV}"
    ;;
  *)
    echo "Usage: $0 [helm|kustomize] [dev|staging|prod]" >&2
    exit 1
    ;;
esac
