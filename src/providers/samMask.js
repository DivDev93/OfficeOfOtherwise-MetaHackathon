import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';
import { PNG } from 'pngjs';

// An explicitly empty output-text lane is a valid no-match. Missing, malformed,
// refused or contradictory content is not evidence that no object was found.
function samOutputText(response) {
  if (!response || typeof response !== 'object') throw new Error('SAM response is not an object');
  const hasHelper = response.output_text !== undefined && response.output_text !== null;
  if (hasHelper && typeof response.output_text !== 'string') throw new Error('SAM response output_text is not a string');
  if (response.output != null && !Array.isArray(response.output)) throw new Error('SAM response output is not an array');
  const parts = [];
  for (const item of response.output ?? []) {
    if (item?.type !== 'message') continue;
    if (!Array.isArray(item.content)) throw new Error('SAM message content is not an array');
    for (const part of item.content) {
      if (part?.type === 'refusal') throw new Error('SAM response was refused');
      if (part?.type !== 'output_text') continue;
      if (typeof part.text !== 'string') throw new Error('SAM output text is not a string');
      parts.push(part.text);
    }
  }
  const nested = parts.join('');
  if (hasHelper && parts.length && response.output_text !== nested) throw new Error('SAM output_text conflicts with message content');
  if (hasHelper) return response.output_text;
  if (parts.length) return nested;
  throw new Error('SAM response has no recognizable output-text lane');
}

// A missing confidence is unknown, not zero; known confidence sorts first.
export function selectMask(masks) {
  return masks.reduce((best, mask) => {
    if (!best) return mask;
    const a = mask.confidence ?? -1, b = best.confidence ?? -1;
    if (a !== b) return a > b ? mask : best;
    const area = m => m.raster.reduce((sum, bit) => sum + (bit ? 1 : 0), 0);
    return area(mask) > area(best) ? mask : best;
  }, null);
}

function headNoun(prompt) {
  // Drop a trailing prepositional phrase before choosing the last remaining word.
  const phrase = prompt.split(/\s+(?:on|in|at|with|of|for|under|over|beside|near|by)\s+/i)[0];
  return phrase.trim().split(/\s+/).at(-1).replace(/[^\p{L}\p{N}'-]/gu, '');
}

async function parseMasks(text, width, height) {
  async function* events() {
    yield { type: 'response.output_text.delta', item_id: 'sam', output_index: 0, content_index: 0, delta: text };
    yield { type: 'response.output_text.done', item_id: 'sam', output_index: 0, content_index: 0, text };
    yield { type: 'response.completed' };
  }
  const result = await parseImageStream(events()).finalResult;
  if (result.outcome.status !== 'completed' || result.diagnostics.some(d => d.severity === 'error')) {
    throw new Error(`SAM output could not be parsed: ${result.diagnostics.map(d => d.code).join(', ') || result.outcome.status}`);
  }
  const boxes = recordsOfKind(result.records, 'box');
  const records = recordsOfKind(result.records, 'mask');
  if (text.trim() && !records.length) throw new Error('SAM output has text but no recognizable mask records');
  return records.map(record => {
    const box = record.bounds;
    const local = decodeMaskToRaster(record.mask);
    if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height || box.right <= box.left || box.bottom <= box.top) {
      throw new Error('SAM mask bounds do not fit the input image');
    }
    const raster = new Uint8Array(width * height);
    const boxWidth = box.right - box.left, boxHeight = box.bottom - box.top;
    // The mask raster may be lower resolution than the source-pixel box.
    // Map pixel centers with nearest-neighbor sampling to preserve a binary mask.
    for (let y = 0; y < boxHeight; y++) {
      const sourceY = Math.min(record.mask.height - 1, Math.floor((y + 0.5) * record.mask.height / boxHeight));
      for (let x = 0; x < boxWidth; x++) {
        const sourceX = Math.min(record.mask.width - 1, Math.floor((x + 0.5) * record.mask.width / boxWidth));
        raster[(box.top + y) * width + box.left + x] = local[sourceY * record.mask.width + sourceX];
      }
    }
    const boxRecord = boxes.find(item => item.objectId === record.objectId);
    return { objectId: record.objectId, box, confidence: record.confidence ?? boxRecord?.confidence, raster, width, height };
  });
}

/** Segment a PNG; fallback once on no matches. Raster dimensions match the input. */
export function createSamMask({ client, model, env = process.env } = {}) {
  if (!client?.meteredPost) throw new Error('SAM provider needs a metered client');
  model = model ?? env.META_SEGMENT_MODEL ?? 'sam-3.1';
  const price = Number(env.META_SEGMENT_COST_USD ?? 0.05);
  if (!Number.isFinite(price) || price < 0) throw new Error('META_SEGMENT_COST_USD must be finite and nonnegative');
  return {
    async segment({ image, mime, prompt }) {
      if (!Buffer.isBuffer(image) || mime !== 'image/png') throw new Error('SAM provider requires a PNG buffer');
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('SAM prompt must be a nonempty noun phrase');
      const { width, height } = PNG.sync.read(image);
      const fullPrompt = prompt.trim();
      const fallback = headNoun(fullPrompt);
      const prompts = fallback && fallback.toLowerCase() !== fullPrompt.toLowerCase() ? [fullPrompt, fallback] : [fullPrompt];
      const trace = [], rawOutputs = [], rawResponses = [];
      let masks = [];
      for (const text of prompts) {
        const start = Date.now();
        let paid = false;
        try {
        const response = await client.meteredPost('/responses', {
          model,
          input: [{ role: 'user', content: [
            { type: 'input_text', text },
            { type: 'input_image', image_url: `data:${mime};base64,${image.toString('base64')}` },
          ] }],
          metadata: { include_confidence: 'true' },
        }, { costUsd: price, label: 'sam-segmentation' });
        paid = true;
        rawResponses.push(response);
        trace.push({ model, ms: Date.now() - start, costUsd: price, prompt: text });
        const raw = samOutputText(response);
        rawOutputs.push(raw);
        if (response?.status && response.status !== 'completed') {
          throw new Error(`SAM response did not complete: ${response.status}`);
        }
        masks = await parseMasks(raw, width, height);
        if (masks.length) break;
        } catch (error) {
          if (!paid) trace.push({ model, ms: Date.now() - start, costUsd: 0, prompt: text, status: 'failed' });
          error.trace = trace;
          error.rawOutputs = rawOutputs;
          error.rawResponses = rawResponses;
          error.costUsd = trace.reduce((sum, step) => sum + step.costUsd, 0);
          throw error;
        }
      }
      return { masks, selectedMask: selectMask(masks), costUsd: trace.reduce((sum, step) => sum + step.costUsd, 0), trace, rawOutputs, rawResponses };
    },
  };
}
