// Per-model price table (USD). Only Muse Spark has published pricing so far
// (public preview: $1.25/M input, $0.15/M cached input, $4.25/M output).
// Models without published prices fall back to the most expensive known text
// rate and are flagged `estimated`, so the spend cap errs on the safe side.

export const TOKEN_PRICES = {
  'muse-spark': { input: 1.25, cachedInput: 0.15, output: 4.25 },
};

const FALLBACK_TOKEN_PRICE = TOKEN_PRICES['muse-spark'];

/** Match "muse-spark-1.3" → "muse-spark" family pricing. */
function tokenPriceFor(model = '') {
  const family = Object.keys(TOKEN_PRICES).find(k => model === k || model.startsWith(`${k}-`));
  return family ? { price: TOKEN_PRICES[family], estimated: false } : { price: FALLBACK_TOKEN_PRICE, estimated: true };
}

/**
 * Cost of a Responses / Chat call from its `usage` block.
 * Handles both Responses (input_tokens/output_tokens) and Chat Completions
 * (prompt_tokens/completion_tokens) shapes. Reasoning tokens are already
 * included in output_tokens per the Meta docs.
 */
export function costFromUsage(model, usage = {}) {
  const { price, estimated } = tokenPriceFor(model);
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const usd = ((input - cached) * price.input + cached * price.cachedInput + output * price.output) / 1e6;
  return { usd, estimated };
}

/** Conservative pre-flight estimate for a text call, used to refuse calls that would cross the cap. */
export function estimateTextCost(model, { inputChars = 0, maxOutputTokens = 4096 } = {}) {
  const { price } = tokenPriceFor(model);
  const inputTokens = Math.ceil(inputChars / 3); // pessimistic chars→tokens
  return (inputTokens * price.input + maxOutputTokens * price.output) / 1e6;
}
