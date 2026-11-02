import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const keyFor = ({ questionId, historyId, eventId, revision, kind }) => createHash('sha256')
  .update(JSON.stringify([questionId, historyId, eventId, revision, kind])).digest('hex');

export function historyEventRevision(event) {
  const content = Object.fromEntries(Object.entries(event ?? {}).filter(([key]) =>
    !['sceneRef', 'cutoutRef', 'heroRef', 'modelRef', 'checkFlags'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** Durable, history-identity-specific image reservations; uncertain work is never auto-dispatched again. */
export function createHistoryMediaStore(root, { now = Date.now } = {}) {
  const directory = join(root, '.history-media');
  const images = join(root, 'history-media');
  const recordPath = key => join(directory, `${key}.json`);
  const imagePath = key => join(images, `${key}.png`);
  const active = new Set();
  const prepare = () => { mkdirSync(directory, { recursive: true }); mkdirSync(images, { recursive: true }); };
  const read = key => {
    try { return JSON.parse(readFileSync(recordPath(key), 'utf8')); }
    catch { return existsSync(recordPath(key)) ? { key, status: 'unknown' } : null; }
  };
  const atomic = (path, data) => {
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, data, { flag: 'wx', flush: true, mode: 0o600 });
    renameSync(temp, path);
  };
  const identity = value => ({ questionId: value.questionId, historyId: value.historyId, eventId: value.eventId,
    revision: value.revision, kind: value.kind });
  return {
    keyFor,
    imagePath,
    get(value) {
      const key = keyFor(value), record = read(key);
      if (record?.status === 'pending' && !active.has(key)) {
        const unknown = { ...record, status: 'unknown', updatedAt: new Date(now()).toISOString(), reason: 'server-restarted-during-generation' };
        try { prepare(); atomic(recordPath(key), JSON.stringify(unknown)); } catch { /* return unknown even if repair cannot be persisted */ }
        return unknown;
      }
      return record;
    },
    byKey(key) { return /^[a-f0-9]{64}$/.test(key) ? this.get(read(key) ?? {}) : null; },
    reserve(value) {
      const item = identity(value), key = keyFor(item);
      prepare();
      const record = { ...item, key, status: 'pending', createdAt: new Date(now()).toISOString() };
      try {
        writeFileSync(recordPath(key), JSON.stringify(record), { flag: 'wx', flush: true, mode: 0o600 });
        active.add(key);
        return { status: 'reserved', record };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = this.get(item);
        return { status: existing?.status ?? 'unknown', record: existing };
      }
    },
    complete(record, buffer) {
      atomic(imagePath(record.key), buffer);
      atomic(recordPath(record.key), JSON.stringify({ ...record, status: 'complete', updatedAt: new Date(now()).toISOString() }));
      active.delete(record.key);
    },
    finish(record, status, reason) {
      if (!['empty', 'unknown'].includes(status)) throw new Error('Invalid history media terminal status');
      atomic(recordPath(record.key), JSON.stringify({ ...record, status, ...(reason ? { reason } : {}), updatedAt: new Date(now()).toISOString() }));
      active.delete(record.key);
    },
    releaseUndispatched(record) {
      const current = read(record.key);
      if (current?.status !== 'pending' || current.key !== record.key) throw new Error('History media reservation changed');
      renameSync(recordPath(record.key), join(directory, `${record.key}.${randomUUID()}.attempt.json`));
      active.delete(record.key);
    },
  };
}
