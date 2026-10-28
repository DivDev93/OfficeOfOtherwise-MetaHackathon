import { createServer } from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const assets = new Set(['branch.json', 'trace.json', 'hero.png', 'mask.png', 'cutout.png', 'model.glb', 'model.meshopt.glb']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const safeId = s => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s);
const TWO_D_ONLY_REASON = 'SAM 3.1 returned no mask; cutout and 3D model were not generated';

function renderMetadata(branch) {
  return branch?.renderStatus === '2d-only'
    ? { renderStatus: '2d-only', status: 'provisional', reason: TWO_D_ONLY_REASON }
    : {};
}

export function createDemoServer({ runsDir = resolve('demo/runs'), liveRunsDir = resolve('out'), webDir = resolve('web'), runPipeline, env = process.env, rateLimit = 5, rateWindowMs = 60_000, now = Date.now } = {}) {
  let busy = false;
  const requests = new Map();
  const liveRoots = new Map();
  const root = resolve(webDir), runsRoot = resolve(runsDir), liveRoot = resolve(liveRunsDir);
  const secrets = [env.DEMO_ACCESS_CODE, env.META_API_KEY, env.MODEL_API_KEY, env.CHRONOS_API_TOKEN, env.CHRONOS_API_BASE, env.CHRONOS_3D_ENDPOINT].filter(x => typeof x === 'string' && x.length > 0);
  function clean(value) {
    if (typeof value === 'string') return secrets.reduce((s, secret) => s.split(secret).join('[redacted]'), value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      const safe = {};
      for (const [key, item] of Object.entries(value)) {
        if (/token|secret|api.?key|authorization|access.?code/i.test(key)) continue;
        if (key === 'rejected' && Array.isArray(item)) {
          safe.rejectedCount = item.length;
          safe.rejected = item.map(entry => ({
            ...(safeId(entry?.branch?.id) ? { id: entry.branch.id } : {}),
            ...(['war', 'politics', 'other', 'unverifiable'].includes(entry?.category) ? { category: entry.category } : {}),
            ...(['keyword', 'model'].includes(entry?.layer) ? { layer: entry.layer } : {}),
          }));
          continue;
        }
        safe[key] = clean(item);
      }
      return safe;
    }
    return value;
  }
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(clean(data))); }
  async function file(res, path, method, allowedRoot) {
    try {
      const actualRoot = await realpath(allowedRoot);
      const actualPath = await realpath(path);
      const separator = actualRoot.includes('\\') ? '\\' : '/';
      if (!actualPath.startsWith(actualRoot + separator)) throw new Error('Outside root');
      let data = await readFile(actualPath);
      if ((allowedRoot === runsRoot || allowedRoot === liveRoot) && extname(path) === '.json') data = Buffer.from(JSON.stringify(clean(JSON.parse(data.toString('utf8')))));
      res.writeHead(200, { 'Content-Type': types[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff' });
      res.end(method === 'HEAD' ? undefined : data);
    } catch { json(res, 404, { error: 'Not found' }); }
  }
  async function listRuns() {
    let entries;
    try { entries = await readdir(runsRoot, { withFileTypes: true }); } catch { return []; }
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !safeId(entry.name)) continue;
      const item = await manifest(entry.name);
      if (item) { const { assets: _assets, assetUrls: _assetUrls, branch: _branch, ...summary } = item; result.push(summary); }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
  async function manifest(id) {
    const roots = [runsRoot, liveRoots.get(id)].filter(Boolean);
    for (const candidate of roots) {
      try {
        const actualRoot = await realpath(candidate);
        const runDir = await realpath(join(candidate, id));
        const separator = actualRoot.includes('\\') ? '\\' : '/';
        if (!runDir.startsWith(actualRoot + separator)) continue;
        const branchPath = await realpath(join(runDir, 'branch.json'));
        if (!branchPath.startsWith(runDir + separator)) continue;
        const branch = JSON.parse(await readFile(branchPath, 'utf8'));
        const present = [];
        for (const name of assets) {
          try {
            const path = await realpath(join(runDir, name));
            if (path.startsWith(runDir + separator) && (await stat(path)).isFile()) present.push(name);
          } catch { /* missing asset */ }
        }
        const value = x => typeof x === 'string' ? x : '';
        let provisional;
        try {
          const manifestPath = await realpath(join(runDir, 'manifest.json'));
          if (manifestPath.startsWith(runDir + separator)) {
            const metadata = JSON.parse(await readFile(manifestPath, 'utf8'));
            if (['provisional', 'simulated'].includes(metadata.status)) provisional = { status: metadata.status, reason: value(metadata.reason) };
          }
        } catch { /* optional metadata */ }
        const assetUrls = Object.fromEntries(present.map(name => [name, `/runs/${encodeURIComponent(id)}/${name}`]));
        const rendering = renderMetadata(branch);
        return { id, title: value(branch.hero?.title) || value(branch.title) || value(branch.divergence) || id, divergence: value(branch.divergence), ...rendering, status: provisional?.status ?? rendering.status ?? (value(branch.status) || 'unknown'), ...((provisional?.reason ?? rendering.reason) ? { reason: provisional?.reason ?? rendering.reason } : {}), hasModel: present.includes('model.glb') || present.includes('model.meshopt.glb'), assets: present, assetUrls, branch };
      } catch { /* no valid manifest in this root */ }
    }
    return null;
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if ((req.method === 'GET' || req.method === 'HEAD') && path === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        const replayOnly = env.DEMO_REPLAY_ONLY === 'true' || typeof env.DEMO_ACCESS_CODE !== 'string' || env.DEMO_ACCESS_CODE.length === 0;
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', replayOnly }));
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && path === '/runs') return json(res, 200, { runs: await listRuns() });
      if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/runs/')) {
        const segments = path.split('/');
        if (segments.length === 3 && safeId(segments[2])) {
          const data = await manifest(segments[2]);
          return data ? json(res, 200, data) : json(res, 404, { error: 'Not found' });
        }
        if (segments.length !== 4 || !safeId(segments[2]) || !assets.has(segments[3])) return json(res, 404, { error: 'Not found' });
        const cached = join(runsRoot, segments[2], segments[3]);
        if (await stat(cached).then(s => s.isFile()).catch(() => false)) return file(res, cached, req.method, runsRoot);
        const registeredRoot = liveRoots.get(segments[2]);
        if (registeredRoot) return file(res, join(registeredRoot, segments[2], segments[3]), req.method, registeredRoot);
        return json(res, 404, { error: 'Not found' });
      }
      if (req.method === 'POST' && path === '/api/run') {
        if (env.DEMO_REPLAY_ONLY === 'true') return json(res, 503, { error: 'Live generation is disabled. Use replay mode.' });
        const configured = env.DEMO_ACCESS_CODE;
        const provided = req.headers['x-demo-access-code'];
        const a = Buffer.from(typeof configured === 'string' ? configured : '');
        const b = Buffer.from(typeof provided === 'string' ? provided : '');
        if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) return json(res, 403, { error: 'Live generation is unavailable. Use replay mode.' });
        const ip = req.socket.remoteAddress ?? 'unknown', t = now();
        const previous = (requests.get(ip) ?? []).filter(n => t - n < rateWindowMs);
        if (previous.length >= rateLimit) return json(res, 429, { error: 'Rate limit reached. Try replay mode.' });
        previous.push(t); requests.set(ip, previous);
        if (busy) return json(res, 429, { error: 'A live run is already in progress. Try replay mode.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) return json(res, 413, { error: 'Request too large' }); }
        let input;
        try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        if (typeof input?.divergence !== 'string' || !input.divergence.trim() || input.divergence.length > 2000) return json(res, 400, { error: 'A divergence is required' });
        const dailyCapUsd = Number(env.DEMO_DAILY_CAP_USD ?? 3);
        if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) return json(res, 503, { error: 'Live generation is unavailable. Use replay mode.' });
        // Acquire before async initialization so simultaneous requests cannot bypass the gate.
        if (busy) return json(res, 429, { error: 'A live run is already in progress. Try replay mode.' });
        busy = true;
        try {
          const runner = runPipeline ?? await import('../src/demo/pipeline.js').then(m => m.createDemoRunner({ env, dailyCapUsd }));
          if (typeof runner !== 'function' || runner.enforcesDailyCap !== true) return json(res, 503, { error: 'Live generation is unavailable. Use replay mode.' });
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
          res.flushHeaders();
          const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          const emit = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(clean(data))}\n\n`); };
          const allowed = new Set(['policy', 'propose', 'review', 'image', 'cutout', '3d']);
          try {
            const result = await runner({ divergence: input.divergence.trim(), signal: controller.signal, dailyCapUsd, onStep: event => { if (allowed.has(event?.step)) { if (safeId(event.runId ?? '')) liveRoots.set(event.runId, liveRoot); emit(event.step, event); } } });
            if (safeId(result?.runId ?? '')) liveRoots.set(result.runId, liveRoot);
            emit('complete', { ...result, ...renderMetadata(result?.branch), step: 'complete' });
          } catch { emit('error', { step: 'error', error: 'Live generation failed. Check server logs and use replay mode.' }); }
          res.end();
        } finally { busy = false; }
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        let decoded;
        try { decoded = decodeURIComponent(path); } catch { return json(res, 400, { error: 'Invalid path' }); }
        const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
        if (!relative || relative.includes('\\') || relative.split('/').some(s => s === '..' || s.startsWith('.'))) return json(res, 404, { error: 'Not found' });
        const target = resolve(root, relative);
        if (!target.startsWith(root + (root.includes('\\') ? '\\' : '/'))) return json(res, 404, { error: 'Not found' });
        return file(res, target, req.method, root);
      }
      json(res, 404, { error: 'Not found' });
    } catch { if (!res.headersSent) json(res, 500, { error: 'Server error' }); else res.end(); }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST || '0.0.0.0';
  createDemoServer().listen(port, host, () => console.log(`Demo server listening on port ${port}`));
}
