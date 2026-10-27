// Shared Meta Model API client. Every Meta call in this repo goes through here so
// the spend cap, retries and cost accounting are enforced in one place.
//
// API: https://api.meta.ai/v1, bearer auth, OpenAI-compatible
// (Responses, Chat Completions, Messages, Files, Models).

import { costFromUsage, estimateTextCost } from './pricing.js';
import { memoryLedger } from './spendLedger.js';

export const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';

export class SpendCapError extends Error {
  constructor(spent, estimate, cap) {
    super(`Meta spend cap reached: spent $${spent.toFixed(4)} + next call ~$${estimate.toFixed(4)} > cap $${cap.toFixed(2)}`);
    this.name = 'SpendCapError';
    Object.assign(this, { spent, estimate, cap });
  }
}

export class MetaApiError extends Error {
  constructor(status, _body, path) {
    super(`Meta API ${status} on ${path}`);
    this.name = 'MetaApiError';
    Object.assign(this, { status, path });
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** Pull the answer text out of a Responses payload (SDK-style `output_text`, or walk `output`). */
export function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  return (response?.output ?? [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text)
    .join('');
}

/**
 * @param {object} [opts]
 * @param {string} [opts.apiKey]       defaults to META_API_KEY, then MODEL_API_KEY (the name Meta's docs use)
 * @param {string} [opts.baseUrl]
 * @param {number} [opts.spendCapUsd]  defaults to META_SPEND_CAP_USD, then 100
 * @param {object} [opts.ledger]       { total(), add(entry) }
 * @param {Function} [opts.fetch]
 * @param {number} [opts.maxRetries]
 * @param {Function} [opts.sleep]
 */
export function createMetaClient(opts = {}) {
  const env = opts.env ?? process.env;
  const apiKey = (opts.apiKey ?? env.META_API_KEY ?? env.MODEL_API_KEY ?? '').trim() || undefined;
  const baseUrl = ((opts.baseUrl ?? env.META_API_BASE_URL ?? '').trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  let parsedBase;
  try { parsedBase = new URL(baseUrl); } catch { throw new Error('Invalid META_API_BASE_URL'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsedBase.hostname);
  if ((parsedBase.protocol !== 'https:' && !(parsedBase.protocol === 'http:' && loopback)) || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) throw new Error('Invalid META_API_BASE_URL');
  const spendCapUsd = Number(opts.spendCapUsd ?? env.META_SPEND_CAP_USD ?? 100);
  if (!Number.isFinite(spendCapUsd) || spendCapUsd < 0) throw new Error('META_SPEND_CAP_USD must be finite and nonnegative');
  const dailyCapUsd = opts.dailyCapUsd === undefined ? undefined : Number(opts.dailyCapUsd);
  if (dailyCapUsd !== undefined && (!Number.isFinite(dailyCapUsd) || dailyCapUsd < 0)) throw new Error('Daily cap must be finite and nonnegative');
  const ledger = opts.ledger ?? memoryLedger();
  if (typeof ledger.reserveMeta !== 'function' || typeof ledger.settleMeta !== 'function' || typeof ledger.markMetaUncertain !== 'function') throw new Error('Atomic Meta ledger required');
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));

  let active = 0;
  const idleWaiters = [];
  function reserve(estimateUsd) {
    if (!apiKey) throw new Error('META_API_KEY is not set (see .env.example)');
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) throw new Error('Call cost must be finite and nonnegative');
    const result = ledger.reserveMeta({ estimateUsd, capUsd: spendCapUsd, dailyCapUsd });
    if (result.refused) throw new SpendCapError(result.spent, estimateUsd, result.cap);
    active++;
    return result.id;
  }
  function finish() {
    active--;
    if (!active) for (const resolve of idleWaiters.splice(0)) resolve();
  }

  async function http(method, path, body) {
    if (!apiKey) throw new Error('META_API_KEY is not set (see .env.example)');
    for (let attempt = 0; ; attempt++) {
      let res;
      try { res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
      }); } catch { throw new Error('Meta request failed'); }
      if (res.ok) { try { return await res.json(); } catch { throw new Error('Invalid Meta response'); } }
      if (method === 'POST' || !RETRYABLE.has(res.status) || attempt >= maxRetries) {
        throw new MetaApiError(res.status, undefined, path);
      }
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 500 * 2 ** attempt) * (0.5 + Math.random()); // exponential + jitter
      await sleep(backoff);
    }
  }

  /**
   * Generic metered POST for endpoints without token usage (images, segmentation).
   * The caller supplies the per-call cost, since Meta hasn't published those prices yet.
   */
  async function meteredPost(path, body, { costUsd, label }) {
    const reservation = reserve(costUsd);
    let settled = false;
    try {
      const json = await http('POST', path, body);
      ledger.settleMeta(reservation, { label: label ?? path, model: body?.model, usd: costUsd, estimated: true });
      settled = true;
      return json;
    } catch (error) { if (!settled) ledger.markMetaUncertain(reservation); throw error; } finally { finish(); }
  }

  /** POST /responses (non-streaming). Returns { text, response, usage, costUsd }. */
  async function respond({ model, input, instructions, maxOutputTokens = 4096, label, ...rest }) {
    if (!model) throw new Error('respond() needs a model id');
    if (Object.hasOwn(rest, 'max_output_tokens') || Object.hasOwn(rest, 'tools') || Object.hasOwn(rest, 'tool_choice')) throw new Error('Unsupported metered response options');
    const body = { model, input, ...(instructions ? { instructions } : {}), ...rest, max_output_tokens: maxOutputTokens };
    const inputBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    const estimate = estimateTextCost(model, { inputBytes, maxOutputTokens });
    const reservation = reserve(estimate);
    let settled = false;
    try {
      const response = await http('POST', '/responses', body);
      const { usd, estimated } = costFromUsage(model, response.usage);
      ledger.settleMeta(reservation, { label: label ?? 'responses', model, usd, estimated, usage: response.usage });
      settled = true;
      return { text: outputText(response), response, usage: response.usage, costUsd: usd };
    } catch (error) { if (!settled) ledger.markMetaUncertain(reservation); throw error; } finally { finish(); }
  }

  return {
    respond,
    meteredPost,
    listModels: () => http('GET', '/models'),
    spent: () => ledger.total(),
    remaining: () => Math.max(0, spendCapUsd - ledger.total() - ledger.reserved()),
    waitForIdle: () => active ? new Promise(resolve => idleWaiters.push(resolve)) : Promise.resolve(),
    spendCapUsd,
    ledger,
  };
}
