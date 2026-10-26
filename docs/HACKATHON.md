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
