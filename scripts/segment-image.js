// Prepare one metered SAM attempt against an existing PNG.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMetaClient } from '../src/lib/metaClient.js';
import { fileLedger } from '../src/lib/spendLedger.js';
import { keywordCheck } from '../src/guardrails/topicPolicy.js';
import { createSamMask } from '../src/providers/samMask.js';
import { decodePng, applyMask, writeMaskPng, writeCutoutPng } from '../src/lib/png.js';

export async function runSegmentImage({ imagePath, prompt, client, outRoot = 'out', env = process.env }) {
  if (typeof prompt !== 'string' || !/^[A-Za-z]+$/.test(prompt)) throw new Error('Prompt must be one alphabetic word');
  if (!keywordCheck(prompt).allowed) throw new Error('Prompt is blocked by the topic policy');
  if (!imagePath) throw new Error('An existing PNG path is required');
  const source = resolve(imagePath);
  const image = readFileSync(source);
  const decoded = decodePng(image);
  // Disable transport retries as well as provider fallback: this diagnostic is
  // explicitly limited to one request, even when the server returns a 5xx.
  const metered = client ?? createMetaClient({ env, ledger: fileLedger(join(outRoot, 'spend.json')), maxRetries: 0 });
  // Enforce the one-attempt limit independently of provider fallback behavior.
  let attempts = 0;
  const singleAttempt = { meteredPost(...args) {
    if (++attempts > 1) throw new Error('Single SAM attempt limit reached');
    return metered.meteredPost(...args);
  } };
  const provider = createSamMask({ client: singleAttempt, env });
  mkdirSync(outRoot, { recursive: true });
  const dir = mkdtempSync(join(outRoot, `sam-${Date.now()}-`));
  const json = (name, data) => writeFileSync(join(dir, name), JSON.stringify(data, null, 2));
  let result;
  try {
    result = await provider.segment({ image, mime: 'image/png', prompt });
  } catch (error) {
    for (const [i, response] of (error.rawResponses ?? []).entries()) json(`sam-response-${i + 1}.json`, response);
    for (const [i, text] of (error.rawOutputs ?? []).entries()) writeFileSync(join(dir, `sam-output-${i + 1}.txt`), text);
    json('diagnostics.json', { source, prompt, status: 'error', error: error.message, attempts, trace: error.trace ?? [], costUsd: error.costUsd ?? 0 });
    error.outputDir = dir;
    throw error;
  }
  for (const [i, response] of result.rawResponses.entries()) json(`sam-response-${i + 1}.json`, response);
  for (const [i, text] of result.rawOutputs.entries()) writeFileSync(join(dir, `sam-output-${i + 1}.txt`), text);
  const selected = result.selectedMask;
  if (selected) {
    writeFileSync(join(dir, 'mask.png'), writeMaskPng(selected.raster, selected.width, selected.height));
    writeFileSync(join(dir, 'cutout.png'), writeCutoutPng(applyMask(decoded.data, selected.raster, decoded.width, decoded.height), decoded.width, decoded.height));
  }
  const diagnostics = { source, prompt, status: selected ? 'matched' : 'no_matches', attempts, trace: result.trace, costUsd: result.costUsd, maskCount: result.masks.length, selectedMask: selected ? { objectId: selected.objectId, box: selected.box, confidence: selected.confidence ?? null } : null };
  json('diagnostics.json', diagnostics);
  return { dir, diagnostics };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('Usage: node --env-file-if-exists=.env scripts/segment-image.js <hero.png> <single-noun>');
    process.exitCode = 1;
  } else {
    try {
      const { dir, diagnostics } = await runSegmentImage({ imagePath: args[0], prompt: args[1] });
      console.log(`${diagnostics.status}; estimated cost $${diagnostics.costUsd}; saved ${dir}`);
      if (diagnostics.status !== 'matched') process.exitCode = 1;
    } catch (error) {
      console.error(`${error.message}${error.outputDir ? `; diagnostics saved ${error.outputDir}` : ''}`);
      process.exitCode = 1;
    }
  }
}
