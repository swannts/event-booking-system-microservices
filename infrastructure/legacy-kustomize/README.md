# Legacy Kustomize Manifests

These manifests are retained only as architecture and migration reference. They do not have parity with the maintained Helm chart, migrations, security contexts, Notification PostgreSQL database, or current runtime image contract.

Do not deploy them. The supported Kubernetes entrypoint is:

```bash
./scripts/deploy.sh [dev|staging|prod]
```
