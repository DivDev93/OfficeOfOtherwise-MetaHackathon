# Cloud Run deployment guide

This guide prepares a replay-first Cloud Run service. It does not deploy anything by itself. The image defaults `DEMO_REPLAY_ONLY=true`; the server returns 503 for live-run requests before reading credentials or invoking the pipeline. The container listens on `0.0.0.0:$PORT`; Cloud Run supplies `PORT` (8080 by default). `/health` is a lightweight GET/HEAD probe. Replay data comes from the reviewed `demo/runs/` manifests and assets.

The current public deployment is the [Office of Otherwise replay demo](https://office-otherwise-875096283797.northamerica-northeast2.run.app), revision `office-otherwise-00001-84n`. It is configured for replay only; live model generation is disabled.

## Build and publish

Run these Bash commands from the repository root. Set `PROJECT_ID` to the intended Google Cloud project first. The Artifact Registry repository is created once; image tags use the current Git revision.

```bash
export PROJECT_ID="YOUR_PROJECT_ID"
export REGION="us-central1"
export REPOSITORY="office-otherwise"
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/office-otherwise:$(git rev-parse --short HEAD)"

gcloud config set project "$PROJECT_ID"
gcloud services enable artifactregistry.googleapis.com run.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker --location="$REGION"
gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker buildx build --load --platform linux/amd64 --tag "$IMAGE" .
docker push "$IMAGE"
```

The image uses `node:22-slim`, installs only locked production dependencies, runs as the unprivileged `node` user, and creates a writable `/app/out` directory. `.dockerignore` excludes local output, dependencies, and `.env` files while allowing only the empty/example configuration file.

## Store secrets

Create secrets outside the repository. For example, place the values in temporary local files that are excluded from source control, then remove those files after adding versions:

```bash
gcloud secrets create META_API_KEY --replication-policy=automatic
gcloud secrets versions add META_API_KEY --data-file=/secure/path/meta-api-key.txt
gcloud secrets create DEMO_ACCESS_CODE --replication-policy=automatic
gcloud secrets versions add DEMO_ACCESS_CODE --data-file=/secure/path/demo-access-code.txt

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_IDENTITY="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding META_API_KEY --member="serviceAccount:$RUNTIME_IDENTITY" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding DEMO_ACCESS_CODE --member="serviceAccount:$RUNTIME_IDENTITY" --role=roles/secretmanager.secretAccessor
```

The Cloud Run runtime identity needs `roles/secretmanager.secretAccessor` on both secrets. Google recommends Secret Manager for sensitive settings and supports exposing secret versions as environment variables at deploy time ([Cloud Run service secrets](https://cloud.google.com/run/docs/configuring/services/secrets)). The project may use a dedicated least-privilege runtime identity instead of the default Compute Engine identity shown above.

## Deploy

```bash
META_KEY_ENV="META_API_KEY"
gcloud run deploy office-otherwise \
  --image="$IMAGE" \
  --region="$REGION" \
  --port=8080 \
  --timeout=600s \
  --max-instances=2 \
  --min-instances=0 \
  --allow-unauthenticated \
  --set-env-vars="DEMO_REPLAY_ONLY=true,DEMO_3D_ENABLED=false,DEMO_DAILY_CAP_USD=1,META_SPEND_CAP_USD=2" \
  --set-secrets="$META_KEY_ENV=META_API_KEY:1,DEMO_ACCESS_CODE=DEMO_ACCESS_CODE:1"
```

Unauthenticated Cloud Run ingress is needed for public replay. The live POST route separately requires the secret `x-demo-access-code` header. Cloud Run requires the ingress container to listen on `0.0.0.0` at the configured port, and `gcloud run deploy` accepts `--max-instances` and `--timeout` ([container contract](https://cloud.google.com/run/docs/container-contract), [deploy reference](https://cloud.google.com/sdk/gcloud/reference/run/deploy)).

## Spend and storage limits

Treat this Cloud Run setup as **replay-only** until live spending is redesigned around durable shared state. `DEMO_DAILY_CAP_USD` and the file-backed `out/spend.json` ledger are process/instance-local. Cloud Run's writable container filesystem is ephemeral, instances can restart, and two instances can each admit work against their own daily-cap view. With `--max-instances=2`, the daily setting is not a service-wide spend ceiling; it can allow up to two independent instance-local amounts, and fresh instances can lose prior ledger state. `META_SPEND_CAP_USD` is also enforced against a local ledger. Do not represent either setting as a global cap or expose live access on this deployment as financial protection ([Cloud Run's filesystem is disposable and instance-local](https://cloud.google.com/run/docs/overview/what-is-cloud-run)).

The current live pipeline additionally fails closed without the pre-established task budget checkpoint and ledger under `out/`. The image intentionally excludes `out/`, so simply supplying secrets does not enable a valid live run. The deployment command wires both requested secrets but keeps `DEMO_REPLAY_ONLY=true`; the server gate prevents the access code from enabling live requests. `DEMO_3D_ENABLED=false` also keeps the optional 3D provider disabled. Do not remove the replay-only setting or initialize/reset a budget to bypass these checks.

After a replay-only deployment, check `/health`, `/`, `/runs`, and a listed run's assets from an independent client. The pipeline supports Meta-only live generation when `DEMO_3D_ENABLED=false`; 3D remains opt-in and requires the separate confirmed Chronos configuration. Before enabling any live generation, use an approved durable shared ledger/checkpoint with cross-instance atomic reservations, retain the access code privately, and verify that failed/uncertain requests remain accounted for. Do not add credentials, private provider endpoints, or other deployment URLs to this repository. The public replay URL above is intentionally published for the hackathon submission.
