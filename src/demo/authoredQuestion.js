import { keywordCheck } from '../guardrails/topicPolicy.js';
import { geographyText } from '../../web/geography.js';
import { validRunId } from './continuationStore.js';
import { continuationFor } from './continuation.js';

const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

function normalizePlace(place) {
  if (place === undefined) return undefined;
  if (!place || typeof place !== 'object' || Array.isArray(place)
    || !validText(place.name, 240) || !Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90
    || !Number.isFinite(place.lon) || place.lon < -180 || place.lon > 180) throw new Error('Choose a valid divergence place.');
  return { name: place.name.trim(), lat: place.lat, lon: place.lon };
}

/** Prepare a user-authored question without reserving or changing a generated-child edge. */
export function prepareAuthoredQuestion({ attachment, questionId, divergence, parent, parentSaved, maxDepth = 6 }) {
  if (!validRunId(questionId) || !validText(divergence, 2000)) throw new Error('A valid authored question is required.');
  const prompt = divergence.trim();
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) throw new Error('Choose where the question attaches.');
  if (attachment.mode === 'present-day') {
    if (Object.keys(attachment).some(key => !['mode', 'divergenceYear', 'divergencePlace'].includes(key))) throw new Error('Invalid question attachment.');
    const divergenceYear = attachment.divergenceYear ?? 2026;
    if (!Number.isSafeInteger(divergenceYear) || divergenceYear === 0 || divergenceYear < -100000 || divergenceYear > 3000) throw new Error('Choose a valid divergence year.');
    const divergencePlace = normalizePlace(attachment.divergencePlace);
    if (!keywordCheck(prompt).allowed) throw new Error('This question cannot pass the topic policy.');
    return {
      questionAttachment: { questionId, mode: 'present-day', divergenceYear, ...(divergencePlace ? { divergencePlace } : {}) },
      continuation: undefined,
    };
  }
  if (attachment.mode !== 'current-world' || Object.keys(attachment).some(key => !['mode', 'parentRunId', 'parentBranchId'].includes(key))
    || !validRunId(attachment.parentRunId) || !validRunId(attachment.parentBranchId)) throw new Error('Choose a valid saved world.');
  if (!parent || parent.id !== attachment.parentRunId || !parentSaved || parentSaved.status !== 'complete') throw new Error('The selected world is not available.');
  const continuation = continuationFor(parent, attachment.parentBranchId, parentSaved, maxDepth);
  const selected = continuation.path.at(-1);
  if (!keywordCheck([prompt, ...continuation.path.flatMap(event => [event.title, event.summary, event.place.name, event.causalLink ?? '', geographyText(event.geography)])].join('\n')).allowed) {
    throw new Error('This question cannot pass the topic policy.');
  }
  return {
    continuation,
    questionAttachment: {
      questionId,
      mode: 'current-world',
      parentWorldId: `${attachment.parentRunId}::${attachment.parentBranchId}`,
      parentRunId: attachment.parentRunId,
      parentBranchId: attachment.parentBranchId,
      divergenceYear: selected.year,
      divergencePlace: selected.place,
    },
  };
}
