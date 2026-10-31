# Replay-only Cloud Run release guide

This guide describes a replay-only release for a committed `main` HEAD; it does not deploy anything by itself. The container defaults to `DEMO_REPLAY_ONLY=true` and `DEMO_3D_ENABLED=false`. Live-run requests return `503` before credentials are read or the generation pipeline is invoked. Cloud Run supplies `PORT` (8080 by default); the server listens on `0.0.0.0:$PORT`.

The existing [Office of Otherwise replay demo](https://office-otherwise-875096283797.northamerica-northeast2.run.app) is the public service. A future deployment must reuse the existing project, region, Artifact Registry repository, Cloud Run service, IAM policy, and private revisions. Inspect them first. Do not run resource-provisioning, IAM, secret-creation, traffic, or revision-cleanup commands from a copied example without a separate explicit operator authorization. This guide does not change IAM or route traffic.

## Inspect existing resources

After explicit authorization to prepare a committed `main` release, identify the existing project and service values and inspect current settings before building:

```bash
export PROJECT_ID="EXISTING_PROJECT_ID"
export REGION="northamerica-northeast2"
export REPOSITORY="office-otherwise"
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/office-otherwise:$(git rev-parse --short HEAD)"

gcloud run services describe office-otherwise --project="$PROJECT_ID" --region="$REGION"
gcloud run services get-iam-policy office-otherwise --project="$PROJECT_ID" --region="$REGION"
gcloud run revisions list --service=office-otherwise --project="$PROJECT_ID" --region="$REGION"
```

Use the existing Artifact Registry repository and credentials already approved for release. Do not enable APIs or create repositories/services here. Build and publish only after the source commit and release plan are approved:

```bash
docker buildx build --load --platform linux/amd64 --tag "$IMAGE" .
docker push "$IMAGE"
```

The image uses `node:22-slim`, installs locked production dependencies with `npm ci --omit=dev` (matching the `Dockerfile`), runs as the unprivileged `node` user, and creates a writable `/app/out` directory. `.dockerignore` excludes local output, dependencies, and `.env` files while allowing only `.env.example`.

## Create a replay-only revision without changing IAM or traffic

The release example supplies only the two replay-mode environment variables and clears secret bindings from the new candidate revision. It adds no generation credentials, access code, or spend-budget overrides. `--clear-secrets` removes bindings only from that new revision; it does not delete secret resources or modify existing private revisions. `--no-traffic` leaves existing traffic routing unchanged. Do not add `--allow-unauthenticated`, secret bindings, or traffic changes to this command.

```bash
gcloud run deploy office-otherwise \
  --project="$PROJECT_ID" \
  --image="$IMAGE" \
  --region="$REGION" \
  --set-env-vars="DEMO_REPLAY_ONLY=true,DEMO_3D_ENABLED=false" \
  --clear-secrets \
  --no-traffic
```

This creates a candidate revision with no traffic. Inspect and verify it before any separately authorized traffic change. Public access must continue to follow the service's existing IAM policy; this guide does not make the service public or private.

When `DEMO_REPLAY_ONLY=true`, `POST /api/run`, `POST /api/continue`, `POST /api/event-scene`, and `POST /api/event-cutout` remain disabled. Saved replay data and assets are served without model calls.

## Future live generation is a separate deployment plan

A protected live-generation host would require separate operator authorization, an access-control plan, and durable shared spend accounting. Meta API keys and access codes are optional secrets for that future protected configuration only. They are not part of this replay-only release; no secret creation or attachment is performed by these instructions. The local `out/spend.json` ledger and `DEMO_DAILY_CAP_USD` are instance-local and are not suitable as shared multi-instance Cloud Run limits.

## Verify an authorized public release

Only after the approved release reaches the intended traffic, independently verify `/health`, `/`, `/runs`, and all four saved 3D models (`alexandria`, `beringia`, `green-sahara`, `mechanisms`). Confirm replay-only health and that live-generation requests return `503`. Deploy only the exact committed `main` HEAD; never deploy `develop`, a draft PR, or an unmerged branch.
