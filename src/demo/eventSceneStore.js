import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Reservations survive process exits: an unknown outcome must never dispatch twice.
export function createEventSceneStore(root) {
  const directory = join(root, '.event-scenes');
  const keyFor = (runId, branchId) => createHash('sha256').update(JSON.stringify([runId, branchId])).digest('hex');
  const recordPath = key => join(directory, `${key}.json`);
  const imagePath = key => join(directory, `${key}.png`);
  const prepare = () => mkdirSync(directory, { recursive: true });
  const read = key => { try { return JSON.parse(readFileSync(recordPath(key), 'utf8')); } catch { return existsSync(recordPath(key)) ? { status: 'uncertain' } : null; } };
  const atomic = (path, data) => { const temp = `${path}.${randomUUID()}.tmp`; writeFileSync(temp, data, { flag: 'wx', flush: true }); renameSync(temp, path); };
  return {
    keyFor, imagePath,
    get(runId, branchId) { return read(keyFor(runId, branchId)); },
    byKey(key) { return /^[a-f0-9]{64}$/.test(key) ? read(key) : null; },
    reserve(runId, branchId) {
      prepare(); const key = keyFor(runId, branchId);
      const record = { runId, branchId, key, status: 'in-progress' };
      try { writeFileSync(recordPath(key), JSON.stringify(record), { flag: 'wx', flush: true }); return record; }
      catch (error) { if (error.code === 'EEXIST') return null; throw error; }
    },
    complete(record, buffer) {
      atomic(imagePath(record.key), buffer);
      atomic(recordPath(record.key), JSON.stringify({ ...record, status: 'complete' }));
    },
    finish(record, status) { atomic(recordPath(record.key), JSON.stringify({ ...record, status })); },
    releaseUndispatched(record) {
      const current = read(record.key);
      if (current?.status !== 'in-progress' || current.runId !== record.runId || current.branchId !== record.branchId) throw new Error('Reservation changed');
      renameSync(recordPath(record.key), join(directory, `${record.key}.${randomUUID()}.attempt.json`));
    },
  };
}
