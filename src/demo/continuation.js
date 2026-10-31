import { keywordCheck } from '../guardrails/topicPolicy.js';
import { validRunId } from './continuationStore.js';
import { normalizeContinuation } from '../agents/branchAgent.js';
import { geographyText } from '../../web/geography.js';

export const MAX_CONTINUATION_DEPTH = 6;

export function continuationFor(parent, branchId, saved, maxDepth = MAX_CONTINUATION_DEPTH) {
  if (saved && saved.status !== 'complete') throw new Error('This run is unfinished and cannot be continued.');
  if (parent.branch?.status !== 'ok' || ['blocked', 'empty', 'simulated', 'unknown'].includes(parent.status)) throw new Error('This run cannot be continued.');
  const branch = parent.branch.branches?.find(item => item.id === branchId);
  if (!branch || !validRunId(branch.id)) throw new Error('Choose a saved branch from this run.');
  const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
  if (!text(branch.title, 300) || !text(branch.summary, 4000) || !Number.isInteger(branch.year) || branch.year === 0 || !text(branch.place?.name, 300) || !Number.isFinite(branch.place.lat) || Math.abs(branch.place.lat) > 90 || !Number.isFinite(branch.place.lon) || Math.abs(branch.place.lon) > 180) throw new Error('The saved branch is invalid.');
  const prior = saved?.continuation;
  const path = [...(prior?.path ?? []), { runId: parent.id, branchId: branch.id, title: branch.title, year: branch.year, summary: branch.summary, place: branch.place, ...(branch.causalLink !== undefined ? { causalLink: branch.causalLink } : {}), ...(branch.geography !== undefined ? { geography: branch.geography } : {}) }];
  if (path.length > maxDepth) throw new Error('The continuation depth limit has been reached.');
  const rootDivergence = saved?.rootDivergence ?? parent.divergence;
  if (!text(rootDivergence, 2000) || !keywordCheck([rootDivergence, ...path.flatMap(item => [item.title, item.summary, item.place.name, item.causalLink ?? '', geographyText(item.geography)])].join('\n')).allowed) throw new Error('The saved branch cannot pass the topic policy.');
  return normalizeContinuation({ rootRunId: prior?.rootRunId ?? parent.id, rootDivergence, parentRunId: parent.id, parentBranchId: branchId, path });
}
