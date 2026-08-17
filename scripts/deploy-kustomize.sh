#!/usr/bin/env bash
set -euo pipefail

echo "Kustomize deployment is legacy/reference-only and is no longer supported." >&2
echo "Use ./scripts/deploy.sh [dev|staging|prod] to deploy the maintained Helm chart." >&2
exit 1
