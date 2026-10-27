import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** The stable key names one paid attempt, including retries after a lost response. */
export function chronosIdempotencyKey(runId, hero) {
  if (!runId || !hero) throw new Error('A run id and hero are required');
  return `relic:${createHash('sha256').update(JSON.stringify([runId, hero])).digest('hex')}`;
}

/** Download only an explicitly trusted artifact origin; credentials stay on the API origin. */
export function createChronos3dClient({ baseUrl = process.env.CHRONOS_API_BASE || process.env.CHRONOS_3D_ENDPOINT, token = process.env.CHRONOS_API_TOKEN, providerId = process.env.CHRONOS_3D_PROVIDER || 'trellis', fetch = globalThis.fetch, jobLedger, maxJobs = Number(process.env.CHRONOS_3D_MAX_JOBS ?? 6), allowedArtifactOrigins = [], capabilityConfirmed = false, timeoutMs = 360000, pollMs = 1000 } = {}) {
  if (!baseUrl || !token || typeof fetch !== 'function' || typeof jobLedger?.reserveChronosJob !== 'function') throw new Error('Chronos configuration and durable job ledger are required');
  if (!Number.isInteger(maxJobs) || maxJobs < 0 || maxJobs > 6) throw new Error('Invalid Chronos job limit');
  if (providerId !== 'trellis') throw new Error('Only TRELLIS is supported');
  let base;
  try { base = new URL(baseUrl); } catch { throw new Error('Invalid Chronos configuration'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid Chronos configuration');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Chronos requires HTTPS outside loopback');
  const allowed = new Set(allowedArtifactOrigins.map(value => new URL(value).origin));
  const endpoint = path => new URL(path, base.origin);
  const headers = { authorization: `Bearer ${token}` };
  return {
    async generate({ imagePng, maskPng, idempotencyKey, signal } = {}) {
      if (!Buffer.isBuffer(imagePng) || !imagePng.length || !Buffer.isBuffer(maskPng) || !maskPng.length) throw new Error('Image and mask PNG buffers are required');
      if (typeof idempotencyKey !== 'string' || !/^relic:[a-f0-9]{64}$/.test(idempotencyKey)) throw new Error('Invalid Chronos idempotency key');
      const start = Date.now();
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const request = async (url, init = {}) => {
        try {
          const response = await fetch(url, { ...init, signal: combined, redirect: 'error' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response;
        } catch {
          if (timeout.aborted) throw new Error('Chronos request timed out');
          if (signal?.aborted) throw new Error('Chronos request aborted');
          throw new Error('Chronos request failed');
        }
      };
      const json = async response => { try { return await response.json(); } catch { throw new Error('Invalid Chronos response'); } };
      if (capabilityConfirmed !== true) throw new Error('Chronos TRELLIS capability is not confirmed');
      if (combined.aborted) throw new Error(timeout.aborted ? 'Chronos request timed out' : 'Chronos request aborted');
      // Reservation is durable and never released, including after failure or interruption.
      jobLedger.reserveChronosJob({ idempotencyKey, maxJobs });
      const body = { sourceType: 'image', sourceDataUrl: `data:image/png;base64,${imagePng.toString('base64')}`, maskDataUrl: `data:image/png;base64,${maskPng.toString('base64')}`, providerId: 'trellis', imageProfile: '3d-object', inputIsPanorama: 'no', idempotencyKey, relic: { v: 1 } };
      let job = await json(await request(endpoint('/api/lyra/jobs'), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      if (typeof job.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(job.jobId)) throw new Error('Invalid Chronos job response');
      const jobId = job.jobId;
      const checkProvider = () => { if (job.provider?.id !== 'trellis' && job.provider?.name !== 'trellis') throw new Error('Chronos did not select TRELLIS'); };
      checkProvider();
      let interval = pollMs;
      while (job.status !== 'completed') {
        if (job.status === 'failed') throw new Error('Chronos 3D job failed');
        if (!['queued', 'processing'].includes(job.status)) throw new Error('Invalid Chronos job status');
        try { await delay(interval, undefined, { signal: combined }); } catch { throw new Error(timeout.aborted ? 'Chronos request timed out' : 'Chronos request aborted'); }
        job = await json(await request(endpoint(`/api/lyra/jobs/${encodeURIComponent(jobId)}`), { headers }));
        checkProvider();
        interval = Math.min(interval * 1.5, 10000);
      }
      if (job.artifact?.kind !== 'glb' || typeof job.artifact.url !== 'string') throw new Error('Chronos returned no GLB artifact');
      let artifact;
      try { artifact = new URL(job.artifact.url, base.origin); } catch { throw new Error('Invalid Chronos artifact'); }
      if (artifact.username || artifact.password || artifact.hash || (artifact.origin !== base.origin && (artifact.protocol !== 'https:' || !allowed.has(artifact.origin)))) throw new Error('Chronos artifact origin is not allowed');
      const response = await request(artifact, artifact.origin === base.origin ? { headers } : {});
      let glb;
      try { glb = Buffer.from(await response.arrayBuffer()); } catch { throw new Error('Invalid Chronos artifact'); }
      if (glb.length < 20 || glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length) throw new Error('Invalid GLB artifact');
      return { glb, jobId, ms: Date.now() - start };
    },
  };
}
