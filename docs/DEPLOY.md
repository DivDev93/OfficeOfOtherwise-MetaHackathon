# Demo deployment — draft, not deployed

These are deployment preparation notes. The server and replay routes have local fixture coverage, but the browser UI, TRELLIS handoff and deployment have not been verified. Do not publish until a target, access policy, assets and working routes are confirmed.

## Intended replay-first configuration

- Host the Node server on a platform supporting Node 22, persistent process execution and server-sent events. Install locked dependencies with `npm ci --ignore-scripts`; start with `npm run demo`. It binds to loopback by default; configure `HOST` and `PORT` for the host and verify its health check.
- Package only reviewed, policy-compliant cached runs in `demo/runs/`. A public visitor should be able to view replay without a code; confirm that no public path can initiate paid generation. If no verified runs exist, keep the deployment private until they do.
- Keep `DEMO_ACCESS_CODE` in the host's secret manager. Live requests should require it via the server's access-code header; distribute it privately only to authorized operators. Never embed it in client code or the public repository. Verify rejection without the code, rate limiting and streaming before exposing live access.
- Configure `DEMO_DAILY_CAP_USD` (default 3) and `META_SPEND_CAP_USD` to the operator-authorized remaining budget. Initialize the persistent `out/` ledger and task checkpoint once with `npm run init-demo-budget`; never delete or reset it to bypass a limit. The task-wide Meta limit is $2, so the daily default does not authorize additional spend. The ledger uses persistent reservations and filesystem locking; instances must share a filesystem with compatible atomic rename and locks. Failed or uncertain requests retain reservations and can stop later work pending investigation. The guard uses cost estimates, which are not a guarantee against provider charges exceeding an estimate.
- For live Meta calls, supply `META_API_KEY` (or `MODEL_API_KEY`) privately. Model IDs and optional price estimates are listed in `.env.example`. Leave `TOPIC_POLICY_BLOCK` empty for the strict default; do not loosen it for the hackathon.
- A live 3D handoff additionally requires private `CHRONOS_API_BASE` (or `CHRONOS_3D_ENDPOINT`), `CHRONOS_API_TOKEN`, `CHRONOS_3D_CAPABILITY_CONFIRMED`, and optional `CHRONOS_3D_PROVIDER`, `CHRONOS_3D_MAX_JOBS`, and `CHRONOS_3D_ARTIFACT_ORIGINS`. Keep values in the secret manager. Confirm that the real TRELLIS relic path and any external artifact origin are enabled before setting capability confirmed. The job counter is durable on the shared ledger and conservatively refuses duplicate submissions after an uncertain outcome.

## Before sharing

Verify public replay, access-code rejection, no secret exposure, SSE behavior, cap and rate-limit enforcement, and at least one actual asset in the deployed environment. Check CDN access and dependency licenses. Add the public demo link to the submission only after a successful independent check; record any restrictions. Do not put private endpoints, tokens or storage identifiers in logs, docs or public output.
