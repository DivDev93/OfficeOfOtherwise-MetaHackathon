import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const validRunId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);

// Only this registry authorizes generated directories. Never discover arbitrary output files.
export function createContinuationStore(root, now = Date.now) {
  const directory = join(root, '.continuation');
  const runs = join(directory, 'runs'), edges = join(directory, 'edges'), attempts = join(directory, 'attempts');
  function prepare() { mkdirSync(runs, { recursive: true }); mkdirSync(edges, { recursive: true }); mkdirSync(attempts, { recursive: true }); }
  function read(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
  function atomic(path, value) {
    prepare();
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', flush: true });
    renameSync(temporary, path);
  }
  const runPath = id => join(runs, `${id}.json`);
  const edgePath = (parent, branch) => join(edges, `${createHash('sha256').update(JSON.stringify([parent, branch])).digest('hex')}.json`);
  return {
    get(id) { return validRunId(id) ? read(runPath(id)) : null; },
    list() {
      try { return readdirSync(runs).filter(name => name.endsWith('.json') && validRunId(name.slice(0, -5))).map(name => read(join(runs, name))).filter(item => item && validRunId(item.id)); }
      catch { return []; }
    },
    save(record) {
      if (!validRunId(record.id)) throw new Error('Invalid run identifier');
      const saved = { ...record, updatedAt: new Date(now()).toISOString() };
      atomic(runPath(record.id), saved);
      return saved;
    },
    edge(parent, branch) {
      const path = edgePath(parent, branch), saved = read(path);
      return saved ?? (existsSync(path) ? { status: 'uncertain' } : null);
    },
    reserve(parent, branch, continuation) {
      prepare();
      const record = { parentRunId: parent, parentBranchId: branch, runId: randomUUID(), status: 'in-progress', continuation, updatedAt: new Date(now()).toISOString() };
      try { writeFileSync(edgePath(parent, branch), JSON.stringify(record), { flag: 'wx', flush: true }); return record; }
      catch (error) { if (error.code === 'EEXIST') return null; throw error; }
    },
    finish(edge, status) { atomic(edgePath(edge.parentRunId, edge.parentBranchId), { ...edge, status, updatedAt: new Date(now()).toISOString() }); },
    // Preserve evidence while atomically freeing only our own never-dispatched edge.
    // A crash before the rename leaves it locked; another request can reserve
    // only after the rename has completed.
    releaseUndispatched(edge) {
      if (!validRunId(edge?.parentRunId) || !validRunId(edge?.parentBranchId) || !validRunId(edge?.runId)) throw new Error('Invalid reservation');
      prepare();
      const path = edgePath(edge.parentRunId, edge.parentBranchId), current = read(path);
      if (!current || current.runId !== edge.runId || current.status !== 'in-progress') throw new Error('Reservation changed');
      const archived = join(attempts, `${edge.runId}.json`);
      if (existsSync(archived)) throw new Error('Attempt already archived');
      renameSync(path, archived);
    },
    children(parent) {
      try { return readdirSync(edges).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => read(join(edges, name))).filter(item => item?.parentRunId === parent && validRunId(item.runId)).map(item => ({ branchId: item.parentBranchId, runId: item.runId, status: item.status })); }
      catch { return []; }
    },
  };
}
