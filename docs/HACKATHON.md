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
