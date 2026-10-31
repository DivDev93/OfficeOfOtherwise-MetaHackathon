import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_MAX_EXPANSIONS_PER_SESSION = 20;
export const MAX_EXPANSIONS_PER_SESSION = Number.MAX_SAFE_INTEGER;

export function configuredExpansionLimit(env = process.env) {
  const raw = env.DEMO_MAX_EXPANSIONS_PER_SESSION;
  if (raw === undefined || raw === '') return DEFAULT_MAX_EXPANSIONS_PER_SESSION;
  if (!/^[1-9]\d*$/.test(String(raw))) throw new RangeError('DEMO_MAX_EXPANSIONS_PER_SESSION must be a positive safe integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_EXPANSIONS_PER_SESSION) throw new RangeError('DEMO_MAX_EXPANSIONS_PER_SESSION must be a positive safe integer');
  return value;
}

// One server instance owns this ledger. Keys are browser session IDs and
// node keys are parent run/branch pairs, so retries and concurrent duplicate
// requests cannot consume more than one slot for the same expansion.
export function createExpansionBudget(limit, { filePath } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EXPANSIONS_PER_SESSION) throw new RangeError('Invalid expansion limit');
  const sessions = new Map();
  if (filePath && existsSync(filePath)) {
    const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
    if (persisted?.version !== 1 || !persisted.sessions || typeof persisted.sessions !== 'object' || Array.isArray(persisted.sessions)) throw new Error('Expansion session ledger is invalid');
    for (const [sessionId, keys] of Object.entries(persisted.sessions)) {
      if (!/^[a-f0-9-]{36}$/i.test(sessionId) || !Array.isArray(keys)) throw new Error('Expansion session ledger is invalid');
      sessions.set(sessionId, new Set(keys.filter(key => typeof key === 'string')));
    }
  }
  const persist = () => {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, sessions: Object.fromEntries([...sessions].map(([id, keys]) => [id, [...keys]])) }), { mode: 0o600 });
    renameSync(temp, filePath);
  };
  const valid = sessionId => typeof sessionId === 'string' && /^[a-f0-9-]{36}$/i.test(sessionId) && sessions.has(sessionId);
  return {
    limit,
    issue() { const id = randomUUID(); sessions.set(id, new Set()); persist(); return id; },
    known(sessionId) { return valid(sessionId); },
    reserve(sessionId, nodeKey) {
      if (!valid(sessionId) || typeof nodeKey !== 'string') return { allowed: false, reason: 'invalid' };
      const used = sessions.get(sessionId);
      if (used.has(nodeKey)) return { allowed: true, used: used.size, duplicate: true };
      if (used.size >= limit) return { allowed: false, used: used.size, limit };
      used.add(nodeKey);
      persist();
      return { allowed: true, used: used.size, duplicate: false };
    },
    usage(sessionId) { return sessions.get(sessionId)?.size ?? 0; },
  };
}
