# Agent rules: Office of Otherwise

## Submission freeze — operator instruction, 2026-10-30

Through November 4, 2026 (America/Toronto), do not add features or continue pilot/feedback work. Make only fixes explicitly requested by the operator. No public app hosting or deployment is required or authorized. Keep PR #7 open, draft and unmerged, parked until after the Meta hackathon submission. Preserve the pilot source and its work; do not resume or submit the hackathon entry without a later operator instruction.

The October 30 rollback authorization was historical and limited to that rollback. Any earlier restoration/deployment language is revoked by the later operator instruction, which requires removal of the Office service and forbids restoring it.

For the October 31 submission release, the operator authorized one final `codex/meta-submission-release` PR to `main` instead of `develop`, its normal CI and post-merge checks, merging only that new PR, and publishing the final video and release artifacts. The operator later required removal of the entire Office of Otherwise Cloud Run service and exclusively owned artifacts; do not restore or redeploy it. The current scoped authorization is one corrective branch, `codex/submission-local-access` → `main`, through a normal PR with its normal CI, merge, and post-merge checks. Do not push directly to `main` or deploy an app. Keep `develop` and PR #7 untouched, preserve pilot source and prior evidence, and keep Tattva/Chronos private. Do not run private 3D jobs, accept submission consent, or submit the hackathon entry.

Cleanup status: the Office Cloud Run service, all 11 revisions, and its dedicated image repository have been removed and verified absent. Protected TowAudit service configuration and IAM, other image repositories, project IAM, SQL inventory, and bucket metadata passed the recorded comparison checks. Do not restore the app or change shared resources.

This is a **public** repo submitted to the Meta Global AI Developer Hackathon. Everything committed here is visible to judges and the world.

1. **No secrets, ever.** No API keys, no service account JSON, no `*.a.run.app` URLs, no GCS bucket names, no `TATTVA_*` values. Config comes from env; only `.env.example` is committed. CI runs gitleaks with `.gitleaks.toml`.
2. **No private Chronos / Tattva code.** Talk to the 3D pipeline only over `CHRONOS_3D_ENDPOINT`. Do not copy files from the Chronos repo here.
3. **Topic policy.** Banned by the hackathon: anything political or involving war. Branches, prompts, fixtures and demo content stay in science, technology, culture and geography. The guardrail in `src/guardrails/` is enforced, and it is tested.
4. **Meta models do the core work.** Use the Meta Model API (Muse Wonder, Muse Spark, Muse Image, SAM 3.1). Don't add non-Meta models to the core loop.
5. **Cost.** Every Meta call goes through the shared client, which enforces `META_SPEND_CAP_USD`. Tests use recorded fixtures, never live calls.
6. **Log the work.** Add a line to `docs/HACKATHON.md` for each meaningful change, so judges can see what was built and when.
7. Node ≥ 22, ESM, no build step. Tests use `node --test`.
