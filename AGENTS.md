# Agent rules: Office of Otherwise

This is a **public** repo submitted to the Meta Global AI Developer Hackathon. Everything committed here is visible to judges and the world.

1. **No secrets, ever.** No API keys, no service account JSON, no `*.a.run.app` URLs, no GCS bucket names, no `TATTVA_*` values. Config comes from env; only `.env.example` is committed. CI runs gitleaks with `.gitleaks.toml`.
2. **No private Chronos / Tattva code.** Talk to the 3D pipeline only over `CHRONOS_3D_ENDPOINT`. Do not copy files from the Chronos repo here.
3. **Topic policy.** Banned by the hackathon: anything political or involving war. Branches, prompts, fixtures and demo content stay in science, technology, culture and geography. The guardrail in `src/guardrails/` is enforced, and it is tested.
4. **Meta models do the core work.** Use the Meta Model API (Muse Wonder, Muse Spark, Muse Image, SAM 3.1). Don't add non-Meta models to the core loop.
5. **Cost.** Every Meta call goes through the shared client, which enforces `META_SPEND_CAP_USD`. Tests use recorded fixtures, never live calls.
6. **Log the work.** Add a line to `docs/HACKATHON.md` for each meaningful change, so judges can see what was built and when.
7. Node ≥ 22, ESM, no build step. Tests use `node --test`.
