# Live demo measurements — 2026-10-28

Spark 1.3 now checks user prompts and individual proposed branches. Wonder 1.0 still proposes branches and reviews them; only review sets Responses `reasoning: { effort: "low" }`. The keyword guard and fail-closed classifier behavior remain in place. Model routing can be overridden with `META_TEXT_MODEL_POLICY_PROMPT` and `META_TEXT_MODEL_POLICY_BRANCHES`.

## Method and budget

The isolated `feat/live` worktree started from a copy of the existing ledger: **$2.6447512**, 88 entries, no reservations or uncertain budget flag. The client ceiling for this session was **$5.6447512** (starting ledger plus the authorized $3); the demo task checkpoint imposed a tighter $2 allowance for the full run. The source checkout ledger was left unchanged. New session spend was **$0.2521617**, ending at **$2.8969129**, with no outstanding reservations. No 3D provider call or cloud deployment was made.

Tests ran offline before one tiny reasoning probe and one smoke sequence: a Spark policy check of the requested subtle prohibited prompt, followed by a full Meta-only Alexandria run. No extra baseline run or paid retry was performed. The only segmentation retry was the provider's existing automatic noun fallback within that one run.

The baseline is the recorded Alexandria run `1793139066427` from October 27, repriced from its recorded token usage at the current rates. Its original ledger charges were lower; the comparison below uses **$0.2858568**, preserving the original records. Input/output/cached rates follow [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits). The probe used the documented [Responses reasoning control](https://dev.meta.ai/docs/reasoning).

## Per-step comparison

Same prompt: “What if the Library of Alexandria never burned?” Times are individual call durations; branch checks and review overlap, so rows must not be added as sequential wall time. Branch policy cost is the sum of all five checks; its duration is the slowest concurrent check.

| Step | Before model | Before seconds / USD | After model | After seconds / USD |
| --- | --- | ---: | --- | ---: |
| Prompt policy | Wonder | 7.247 / $0.007780 | Spark | 6.743 / $0.001747 |
| Propose | Wonder, default effort | 24.199 / $0.070952 | Wonder, default effort | 42.268 / $0.093852 |
| Five branch policy checks | Wonder | 6.372 / $0.058045 | Spark | 4.527 / $0.011494 |
| Review | Wonder, default effort | 28.384 / $0.089080 | Wonder, low effort | 14.049 / $0.030816 |
| Image | Muse Image | 10.400 / $0.010000 | Muse Image | 16.162 / $0.010000 |
| SAM | SAM 3.1, one call | 6.012 / $0.050000 | SAM 3.1, two no-match calls | 9.998 / $0.100000 |
| Text total | | $0.225857 | | $0.137909 |
| Attempt through final SAM response | | 76.357 / $0.285857 | | 89.802 / $0.247909 |

Text spend fell **38.9%** and total metered spend fell **13.3%** despite the additional SAM attempt. Review time fell **50.5%** and review cost fell **65.4%**. Overall latency did **not** improve in this sample: proposal generation was slower and SAM needed its noun fallback. These are single observations with different generated candidates, not a controlled quality or latency benchmark. Image and SAM figures are the shared ledger's configured conservative per-call charges, not reconciled provider invoices.

## Policy, reasoning, and quality results

Spark blocked the subtle empire-expansion prompt through its model layer (the keyword layer allowed it), classifying implied military conflict in **6.362s / $0.00386475**. It allowed Alexandria through the model layer and allowed all five generated candidates. The chosen routing therefore keeps Spark for both prompt and branch checks; the Wonder prompt fallback was not needed.

One tiny Wonder Responses request with `reasoning: { effort: "low" }`, `max_output_tokens: 256`, and “Reply only OK.” returned `OK`: **3.014s / $0.000388**, 12 input tokens, 17 output tokens, including seven reasoning tokens. The low-effort live review produced valid structured output on its first attempt, ranked three branches at 9/8/7, supplied causal notes, selected an irrigation engineering branch, and named “brass steam pump” as its concrete image subject. Review reasoning tokens fell from **4,003** in the recorded baseline to **1,065**. This establishes functional output in one run; it does not establish equivalent scientific or visual quality.

The hero image was generated, but both completed SAM responses contained no mask records for the full subject or the noun fallback. The original live attempt stopped at that point. The saved responses were diagnosed offline; no decoder failure was found. A follow-up fixture test runs the real metered SAM provider with that empty response shape and verifies the new graceful result: an explicitly labeled 2D scene, preserved branch/image/paid trace, and no fabricated cutout or 3D call. The final fallback behavior was verified offline without another paid run.

## Time to first branch

From starting the live runner, the proposal event arrived at **49.120s**. The UI now renders five generic, disabled path cards at that event, with candidate text hidden during topic checks. Policy-cleared branch text arrived at **53.772s**, before review completed at **63.369s** and the image event arrived at **79.650s**. UI fixture tests verify these event phases and preserve the guardrail boundary. An offline SSE server was also exercised in the browser: pending cards appeared before the policy gate was released, branch text appeared while review was held, and completion showed the scene with the cutout control disabled and the explicit no-SAM-cutout label. These wall times were measured at the live runner's event callback; browser paint overhead is not included.

## Hosting validation

The Docker image uses Node 22 slim, locked production dependencies, and the non-root `node` user. The built image is **94.6 MB (90.2 MiB)**, uncompressed, as reported by Docker image inspection. All **143 offline tests** pass under Node **22.23.4**. Local HTTP checks verify `/`, `/runs`, and `/health`; browser replay checks verify the cached Alexandria story and replay-only controls. The image excludes `.env`, `.git`, `node_modules` from the build context, and all local `out/` evidence. See [DEPLOY.md](DEPLOY.md) for the exact replay-only Cloud Run command, Secret Manager setup, timeout, and instance limits. Hosted live generation remains gated on durable shared budget state; an instance-local filesystem ledger is not a global daily ceiling.

Private raw measurements remain under ignored `out/live-validation/` and run `out/1793192308837/`. No private provider URL, credential, or generated run asset is added to the public repository by this change.
