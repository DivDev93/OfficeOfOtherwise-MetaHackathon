#!/usr/bin/env node
// Deterministic legacy-run migration. Reads JSON only; never reads environment or calls a model.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateSavedRuns, normalizeAssetRef } from '../web/atlas/worldModel.js';

function usage() {
  return 'Usage: node scripts/migrate-atlas-worlds.js --input <run.json|directory> [--output <new-file.json>]';
}

function argumentsOf(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!['--input', '--output'].includes(name) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(usage());
    if (args[name.slice(2)]) throw new Error(`Duplicate ${name}`);
    args[name.slice(2)] = argv[++index];
  }
  if (!args.input) throw new Error(usage());
  return args;
}

function walkJson(fileOrDirectory) {
  if (statSync(fileOrDirectory).isFile()) return [fileOrDirectory];
  return readdirSync(fileOrDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const absolute = path.join(fileOrDirectory, entry.name);
    if (entry.isDirectory()) return walkJson(absolute);
    return entry.isFile() && entry.name === 'branch.json' ? [absolute] : [];
  });
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function isPngFile(file) {
  if (!existsSync(file)) return false;
  const signature = readFileSync(file).subarray(0, 8);
  return signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}
function toPortableRelative(from, to) {
  const relative = path.relative(from, to).split(path.sep).join('/');
  return normalizeAssetRef(relative);
}

export function verifiedEventSceneRefs(run, runId, runDirectory, sourceRoot, eventDirectoryOverride) {
  const eventDirectory = eventDirectoryOverride ?? path.join(path.dirname(runDirectory), '.event-scenes');
  if (!existsSync(eventDirectory) || !Array.isArray(run.branches)) return {};
  const refs = {};
  for (const branch of run.branches) {
    if (typeof branch?.id !== 'string') continue;
    const key = sha256(Buffer.from(JSON.stringify([runId, branch.id]), 'utf8'));
    const metadataFile = path.join(eventDirectory, `${key}.json`);
    const imageFile = path.join(eventDirectory, `${key}.png`);
    if (!existsSync(metadataFile) || !isPngFile(imageFile)) continue;
    let metadata;
    try { metadata = JSON.parse(readFileSync(metadataFile, 'utf8')); } catch { continue; }
    if (metadata.status !== 'complete' || metadata.key !== key || metadata.runId !== runId || metadata.branchId !== branch.id) continue;
    const imagePath = toPortableRelative(sourceRoot, imageFile);
    if (imagePath) refs[`${runId}:${branch.id}`] = { sceneRef: { path: imagePath, status: 'complete' } };
  }
  return refs;
}

function loadRecord(file, sourceRoot, sourcePath, eventDirectory) {
  const bytes = readFileSync(file);
  let run;
  try { run = JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new Error(`Invalid JSON in ${file}: ${error.message}`); }
  const runId = run.runId ?? run.id ?? path.basename(path.dirname(file));
  const refs = verifiedEventSceneRefs(run, runId, path.dirname(file), sourceRoot, eventDirectory);
  if (run.hero?.branchId) {
    const dir = path.dirname(file);
    const cutout = existsSync(path.join(dir, 'cutout.png')) ? toPortableRelative(sourceRoot, path.join(dir, 'cutout.png')) : undefined;
    const modelFile = ['model.meshopt.glb', 'model.glb'].find(name => existsSync(path.join(dir, name)));
    const model = modelFile ? toPortableRelative(sourceRoot, path.join(dir, modelFile)) : undefined;
    const hero = isPngFile(path.join(dir, 'hero.png')) ? toPortableRelative(sourceRoot, path.join(dir, 'hero.png')) : undefined;
    const heroId = `${runId}:${run.hero.branchId}`;
    refs[heroId] = { ...refs[heroId], heroSelected: true,
      ...(hero ? { heroRef: { path: hero, status: 'complete' } } : {}),
      ...(cutout ? { cutoutRef: cutout } : {}), ...(model ? { modelRef: model } : {}) };
  }
  return {
    runId,
    run,
    assetRefsByBranch: refs,
    source: { path: sourcePath.split(path.sep).join('/'), sha256: sha256(bytes) },
  };
}

function findEventSceneDirectory(root) {
  if (statSync(root).isFile()) return undefined;
  const found = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.name === '.event-scenes') found.push(absolute);
      else walk(absolute);
    }
  }
  walk(root);
  return found.length === 1 ? found[0] : undefined;
}

function main() {
  const args = argumentsOf(process.argv.slice(2));
  const input = path.resolve(args.input);
  if (!existsSync(input)) throw new Error(`Input does not exist: ${args.input}`);
  const files = walkJson(input);
  if (!files.length) throw new Error('No branch.json records found');
  const output = path.resolve(args.output ?? `${input}.atlas-v1.json`);
  if (files.some(file => path.resolve(file).toLowerCase() === output.toLowerCase())) throw new Error('Output path must not overwrite any source record');
  if (existsSync(output)) throw new Error(`Output already exists; choose a new path: ${output}`);
  const sourceRoot = path.dirname(input);
  const eventDirectory = findEventSceneDirectory(input);
  const records = files.map(file => loadRecord(file, sourceRoot, path.relative(sourceRoot, file), eventDirectory));
  const graph = migrateSavedRuns(records, { sources: records.map(record => record.source) });
  writeFileSync(output, `${JSON.stringify(graph, null, 2)}\n`, { flag: 'wx' });
  const digest = sha256(readFileSync(output));
  process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), output).split(path.sep).join('/'), sha256: digest, counts: graph.metadata.counts }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.message}\n${usage()}\n`); process.exitCode = 1; }
}
