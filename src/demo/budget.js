import { join } from 'node:path';
import { fileLedger } from '../lib/spendLedger.js';

export function resolveLedgerPath({ env = process.env, outputRoot = 'out' } = {}) {
  const custom = typeof env.META_SPEND_LEDGER_PATH === 'string' ? env.META_SPEND_LEDGER_PATH.trim() : '';
  return custom || join(outputRoot, 'spend.json');
}

export function configuredSpendCap({ env = process.env, outputRoot = 'out', initializeLedger = true } = {}) {
  const raw = env.META_SPEND_CAP_USD;
  const envCap = raw === undefined || String(raw).trim() === '' ? 100 : Number(raw);
  if (!Number.isFinite(envCap) || envCap < 0) {
    throw new Error('Invalid META_SPEND_CAP_USD: must be a finite nonnegative number');
  }
  if (initializeLedger) {
    const ledger = fileLedger(resolveLedgerPath({ env, outputRoot }));
    ledger.initialize();
  }
  return envCap;
}

export function configuredDailyCap({ env = process.env, spendCapUsd } = {}) {
  const raw = env.DEMO_DAILY_CAP_USD;
  if (raw === undefined || String(raw).trim() === '') {
    const fallback = spendCapUsd ?? configuredSpendCap({ env, initializeLedger: false });
    if (!Number.isFinite(fallback) || fallback < 0) {
      throw new Error('Invalid META_SPEND_CAP_USD: must be a finite nonnegative number');
    }
    return fallback;
  }
  const daily = Number(raw);
  if (!Number.isFinite(daily) || daily <= 0) {
    throw new Error('Invalid DEMO_DAILY_CAP_USD: must be a positive finite number');
  }
  return daily;
}

export function configuredRateLimit({ env = process.env, isLoopback = false, replayOnly = true } = {}) {
  const raw = env.DEMO_RATE_LIMIT;
  const defaultLimit = isLoopback && !replayOnly ? 60 : 5;
  const limit = raw === undefined || String(raw).trim() === '' ? defaultLimit : Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Invalid DEMO_RATE_LIMIT: must be a positive integer');
  }
  return limit;
}

export function validateBaseUrl(rawUrl) {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const candidate = trimmed || 'https://api.meta.ai/v1';
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new Error('Invalid META_API_BASE_URL'); }
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !localHttp) || parsed.username || parsed.password) {
    throw new Error('Invalid META_API_BASE_URL');
  }
  return candidate.replace(/\/$/, '');
}

export function validateStartupConfig({ env = process.env, outputRoot = 'out' } = {}) {
  validateBaseUrl(env.META_API_BASE_URL);
  const spendCapUsd = configuredSpendCap({ env, outputRoot, initializeLedger: false });
  const dailyCapUsd = configuredDailyCap({ env, spendCapUsd });
  const enable3d = env.DEMO_3D_ENABLED === 'true';
  if (enable3d && (env.CHRONOS_3D_CAPABILITY_CONFIRMED !== 'true' || !(env.CHRONOS_API_BASE?.trim() || env.CHRONOS_3D_ENDPOINT?.trim()) || !env.CHRONOS_API_TOKEN?.trim())) {
    throw new Error('Confirmed Chronos TRELLIS configuration is required when DEMO_3D_ENABLED=true');
  }
  const apiKey = (env.META_API_KEY || env.MODEL_API_KEY || '').trim();
  const hasMetaKey = apiKey.length > 0;
  const explicitReplayOnly = env.DEMO_REPLAY_ONLY === 'true';
  const hasAccessCode = typeof env.DEMO_ACCESS_CODE === 'string' && env.DEMO_ACCESS_CODE.trim().length > 0;
  if (!explicitReplayOnly && hasAccessCode && !hasMetaKey) {
    throw new Error('META_API_KEY is required when DEMO_ACCESS_CODE is configured and DEMO_REPLAY_ONLY is not true');
  }
  const replayOnly = explicitReplayOnly || !hasMetaKey;
  if (!replayOnly) {
    fileLedger(resolveLedgerPath({ env, outputRoot })).initialize();
  }
  return { replayOnly, hasMetaKey, spendCapUsd, dailyCapUsd, enable3d };
}

export const taskSpendCap = configuredSpendCap;
