import { lstat, readFile, readdir, mkdtemp, cp, writeFile, rename, rm, rmdir } from 'node:fs/promises';
import { resolve, join, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 40_000_000;
async function noSymlinks(path) {
  let current = resolve(path);
  while (true) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not accepted');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
async function size(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not accepted');
    if (entry.isDirectory()) total += await size(child);
    else if (entry.isFile()) total += (await lstat(child)).size;
    else throw new Error('Unsupported cache entry');
  }
  return total;
}
async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected regular file');
  return readFile(path);
}
async function removeStaging(path, root) {
  const absolute = resolve(path);
  if (!absolute.startsWith(resolve(root) + sep) || !/^\.attach-(?:stage|backup)-/.test(basename(absolute))) throw new Error('Invalid staging directory');
  await rm(absolute, { recursive: true, force: true });
}

export async function attachGlb({ slug, glbPath, provider = 'trellis', ms = null, outputRoot = 'demo/runs', maxBytes = MAX_BYTES }) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid run slug');
  if (provider !== 'trellis') throw new Error('Unsupported provider');
  if (ms !== null && (!Number.isFinite(ms) || ms < 0)) throw new Error('Invalid duration');
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_BYTES) throw new Error('Invalid cache size cap');
  const root = resolve(outputRoot), run = join(root, slug), source = resolve(glbPath);
  await noSymlinks(root); await noSymlinks(run); await noSymlinks(source);
  const total = await size(root);
  const bytes = await regular(source);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB asset');
  try { await lstat(join(run, 'model.glb')); throw new Error('Model already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifest = JSON.parse(await regular(join(run, 'manifest.json')));
  if (manifest.status !== 'provisional' || manifest.reason !== '3D model not generated') throw new Error('Run is not an eligible provisional cache');
  const branch = JSON.parse(await regular(join(run, 'branch.json')));
  if (branch.status !== 'ok') throw new Error('Run is not eligible');
  const trace = JSON.parse(await regular(join(run, 'trace.json')));
  if (!Array.isArray(trace.steps) || trace.steps.some(step => /3d|chronos/i.test(step.step ?? ''))) throw new Error('Existing 3D provenance cannot be replaced');
  trace.steps.push({ step: '3d', model: 'Tattva TRELLIS (existing infrastructure)', provider: 'trellis', ms, costUsd: null, source: 'gen3d-offline' });
  manifest.status = 'complete'; delete manifest.reason;
  const stage = await mkdtemp(join(root, '.attach-stage-'));
  let backup;
  try {
    await cp(run, stage, { recursive: true, errorOnExist: true });
    await writeFile(join(stage, 'model.glb'), bytes, { flag: 'wx' });
    await writeFile(join(stage, 'trace.json'), JSON.stringify(trace, null, 2) + '\n');
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (total - await size(run) + await size(stage) >= maxBytes) throw new Error('Cache size cap exceeded');
    backup = await mkdtemp(join(root, '.attach-backup-')); await rmdir(backup);
    await rename(run, backup);
    try { await rename(stage, run); } catch (error) { await rename(backup, run); backup = undefined; throw error; }
    await removeStaging(backup, root); backup = undefined;
  } finally { await removeStaging(stage, root); }
}
async function main() {
  const [slug, glbPath, ...args] = process.argv.slice(2);
  if (!slug || !glbPath) throw new Error('Usage: npm run attach-glb -- <slug> <path.glb> [--provider trellis] [--ms <ms>]');
  const options = { slug, glbPath }; const seen = new Set();
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (!value || seen.has(flag) || !['--provider', '--ms'].includes(flag)) throw new Error('Invalid argument');
    seen.add(flag);
    if (flag === '--provider') options.provider = value;
    else { if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error('Invalid duration'); options.ms = Number(value); }
  }
  await attachGlb(options); console.log(`Attached pre-generated TRELLIS model to ${slug}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
