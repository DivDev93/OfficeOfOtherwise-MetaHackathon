// Standard-mode USD per million tokens, from Meta's model pricing page.
// Unknown models fall back to the highest known text rates and are estimated;
// this is not a guarantee about a future model's price.

export const TOKEN_PRICES = {
  'muse-spark': { input: 1.25, cachedInput: 0.15, output: 4.25 },
  'muse-wonder': { input: 4, cachedInput: 0.20, output: 20 },
};

const FALLBACK_TOKEN_PRICE = TOKEN_PRICES['muse-wonder'];

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
export function costFromUsage(model, usage) {
  const { price, estimated } = tokenPriceFor(model);
  const input = usage?.input_tokens !== undefined ? usage.input_tokens : usage?.prompt_tokens;
  const output = usage?.output_tokens !== undefined ? usage.output_tokens : usage?.completion_tokens;
  const details = usage?.input_tokens_details !== undefined ? usage.input_tokens_details : usage?.prompt_tokens_details;
  if (details !== undefined && (details === null || typeof details !== 'object' || Array.isArray(details))) throw new Error('Meta usage unavailable or invalid');
  const cached = details?.cached_tokens === undefined ? 0 : details.cached_tokens;
  if (![input, output, cached].every(n => Number.isSafeInteger(n) && n >= 0) || cached > input) throw new Error('Meta usage unavailable or invalid');
  const usd = ((input - cached) * price.input + cached * price.cachedInput + output * price.output) / 1e6;
  return { usd, estimated };
}

/** Conservative pre-flight estimate for a text call, used to refuse calls that would cross the cap. */
export function estimateTextCost(model, { inputBytes, maxOutputTokens = 4096 } = {}) {
  const { price } = tokenPriceFor(model);
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new Error('Invalid text cost estimate');
  // Reserve one token per serialized UTF-8 byte plus framing allowance.
  // This is a conservative estimate, not a provider-guaranteed token bound.
  const inputTokens = inputBytes + 4096;
  return (inputTokens * price.input + maxOutputTokens * price.output) / 1e6;
}
