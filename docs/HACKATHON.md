# Hackathon log and compliance

Event: Meta Global AI Developer Hackathon. Building Oct 27 – Nov 4, 2026. **Submit by Nov 4, 9:00 PM ET** (target: early afternoon).

## Compliance checklist

- [ ] Repo public, no secrets (gitleaks clean on full history)
- [ ] Uses Meta models: Muse Wonder, Muse Spark, Muse Image, SAM 3.1
- [ ] No war or political content in the product, demo, fixtures or README
- [ ] All assets generated or owned; no scraped media
- [ ] Demo video ≤ 3 min, showing only work built during the event
- [ ] "Built during the hackathon" section accurate (commit range below)
- [ ] Live product link works for judges
- [ ] All contributors listed on the submission page
- [ ] Meta API credits claimed (deadline Nov 4, 9 PM ET)

## Build log

| Date (ET) | Work | Commits |
|---|---|---|
| 2026-10-26 (pre-kickoff) | Repo scaffold: README, license, CI secret scan, structure. No functional code. | initial |
| 2026-10-26 | Shared Meta Model API client (`src/lib/metaClient.js`): bearer auth, Responses API, retries with backoff + jitter on 429/5xx, cost accounting from `usage`, hard spend cap enforced *before* each call, file-backed ledger so the cap holds across runs. `npm run models` to discover model ids. 8 tests on recorded fixtures. | |
| 2026-10-27 | Topic policy (`src/guardrails/topicPolicy.js`): keyword layer + Muse Wonder layer, fails closed, checks both the prompt and every proposed branch. `npm run smoke` for a one-command live check of Muse Wonder. 11 tests. | |
| 2026-10-27 | Smoke test: Muse Wonder confirmed on the Responses API (same shape and usage fields as Spark). Classifier verdicts were truncated by reasoning tokens at 600 max; budget raised to 2500 and the smoke test now prints status, token use and raw output for each check. | |
| 2026-10-27 | Branch agent (`src/agents/branchAgent.js`) on Muse Wonder: policy check on the prompt → propose N+2 geo-anchored branches → policy check per branch → review/score/rank → hero scene with image prompt and cut-out subject. Full per-step trace (model, tokens, cost, ms) for provenance badges. One retry on bad JSON. `npm run branch -- "What if…"` for live runs. 7 tests. | |
| 2026-10-27 | First live branch run: 3 strong branches, $0.045, ~69s. Branch policy checks now run in parallel with the review (rejected branches are dropped from the ranking and can never become the hero), cutting ~8s. | |
| 2026-10-27 | Topic policy categories configurable per deployment (`TOPIC_POLICY_BLOCK`: war, politics, both, none). Hackathon build runs the strict default with no user toggle. | |
| 2026-10-27 | Shared client reserves estimated spend for concurrent calls and rejects invalid budgets. Branch agent settles parallel review/policy calls before returning or failing, so reported cost cannot omit work still running. Fixture regression coverage. | |
| 2026-10-27 | Muse Image provider through the shared metered client ($0.01 default); PNG mask and alpha-cutout encoding with Node zlib and MIT pngjs decoding; request, budget, PNG, and large-response regression tests. | |
| 2026-10-27 | SAM 3.1 provider using the official npm parser as an unmodified, separately SAM-licensed dependency; confidence/area selection, one head-noun retry on no match, and synthetic encoded-mask fixtures. Dependency licenses retained and documented; Node minimum aligned with parser support. | |
| 2026-10-27 | Local harness with saved-branch reuse, fresh policy validation, complete API timing/cost traces, selected-mask provenance, and paid-response failure evidence. Blocked/empty branches stop before image/SAM. CI installs locked dependencies and runs on main pushes/main-targeted PRs, preserving the develop batching budget. | |
| 2026-10-27 | Single authorized live saved-branch check: policy 6.038s/$0.002114; image 14.335s/$0.01; total $0.012114. Image response succeeded but local base64 validation overflowed the stack before saving it; SAM was never called. Replaced that validation, added a 4 MiB regression and full offline provider-to-PNG integration coverage. All 53 tests pass on Node 22.23.3. Live mask/cutout verification awaits authorization for another run. | |
| 2026-10-27 | One further authorized live run: policy 5.224s/$0.00310425; Muse Image 17.327s/$0.01; SAM full phrase 3.288s/$0.05 and head noun 4.512s/$0.05; total estimated $0.11310425. Hero saved; both extracted SAM outputs empty, so no mask or cutout was produced. Saved the two empty extracted outputs as fixtures; full SAM HTTP responses were not retained in that run, so the cause is unconfirmed. Future runs persist full SAM responses in ignored output for diagnosis. | |
| 2026-10-27 | Documentation check: Meta says [non-streaming SAM requests are supported](https://dev.meta.ai/docs/sam/segmenting), and its [SAM model page](https://dev.meta.ai/models/sam-3-1) now lists $2.50 per 1,000 images. The ledger's $0.05 per-call SAM entries are conservative estimates, not confirmed billed amounts. The missing response bodies prevent diagnosing the empty outputs. | |
