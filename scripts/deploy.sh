#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-dev}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${ENV}" in
  dev|staging|prod)
    "${ROOT_DIR}/scripts/deploy-helm.sh" "${ENV}"
    ;;
  *)
    echo "Usage: $0 [dev|staging|prod]" >&2
    exit 1
    ;;
esac
