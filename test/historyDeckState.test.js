import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryDeckState, MAX_KEPT_SUGGESTIONS } from '../web/historyDeckState.js';

const suggestion = (id, year, extra = {}) => ({ id, year, verdict:'fits', ...extra });

test('deck dispositions are chronological, per history, and do not remove or alter suggestions', () => {
  const deck = createHistoryDeckState();
  const suggestions = [suggestion('late', -1900), suggestion('early', -2400), suggestion('middle', -2200)];
  const original = structuredClone(suggestions);
  assert.deepEqual(deck.review({ questionId:'q1', historyId:'h1', suggestions }).unreviewedIds, ['early', 'middle', 'late']);
  assert.equal(deck.keep({ questionId:'q1', historyId:'h1', suggestionId:'middle', suggestions }).status, 'changed');
  assert.equal(deck.pass({ questionId:'q1', historyId:'h1', suggestionId:'early', suggestions }).status, 'changed');
  assert.deepEqual(deck.review({ questionId:'q1', historyId:'h1', suggestions }), {
    unreviewedIds:['late'], keptIds:['middle'], passedIds:['early'], dispositions:{ middle:'kept', early:'passed' },
  });
  assert.deepEqual(deck.review({ questionId:'q1', historyId:'h2', suggestions }).unreviewedIds, ['early', 'middle', 'late']);
  assert.deepEqual(suggestions, original, 'review never deletes or mutates source suggestion records');
});

test('keep-all-fits is chronological, includes passed fits by explicit request, and respects the 32-item ceiling', () => {
  assert.equal(MAX_KEPT_SUGGESTIONS, 32);
  const deck = createHistoryDeckState({ maxKept:2 });
  const suggestions = [
    suggestion('later', -1800),
    suggestion('passed', -2500),
    suggestion('earliest-fit', -3000),
    suggestion('conflict-verdict', -2900, { verdict:'conflicts' }),
    suggestion('conflict-link', -2800, { conflictsWith:'earliest-fit' }),
  ];
  deck.pass({ questionId:'q', historyId:'h', suggestionId:'passed', suggestions });
  const result = deck.keepAllFits({ questionId:'q', historyId:'h', suggestions });
  assert.deepEqual(result.keptIds, ['earliest-fit', 'passed']);
  assert.deepEqual(result.skippedIds, ['later']);
  assert.deepEqual(deck.review({ questionId:'q', historyId:'h', suggestions }).keptIds, ['earliest-fit', 'passed']);
  assert.deepEqual(deck.review({ questionId:'q', historyId:'h', suggestions }).passedIds, []);
  assert.equal(deck.undoLast({ questionId:'q', historyId:'h' }).status, 'undone');
  assert.deepEqual(deck.review({ questionId:'q', historyId:'h', suggestions }).passedIds, ['passed'],
    'undo restores the passed disposition that explicit Keep all replaced');
});

test('keep-all-fits stops at available capacity and undo reverses a grouped or single action', () => {
  const deck = createHistoryDeckState({ maxKept:2 });
  const suggestions = [suggestion('a', -3000), suggestion('b', -2500), suggestion('c', -2200)];
  assert.deepEqual(deck.keepAllFits({ questionId:'q', historyId:'h', suggestions }), {
    keptIds:['a', 'b'], skippedIds:['c'], limit:2,
  });
  assert.deepEqual(deck.review({ questionId:'q', historyId:'h', suggestions }).keptIds, ['a', 'b']);
  assert.deepEqual(deck.undoLast(), { status:'undone', count:2 });
  assert.deepEqual(deck.review({ questionId:'q', historyId:'h', suggestions }).unreviewedIds, ['a', 'b', 'c']);
  deck.pass({ questionId:'q', historyId:'h', suggestionId:'c', suggestions });
  assert.deepEqual(deck.undoLast(), { status:'undone', count:1 });
  assert.equal(deck.getDisposition('q', 'h', 'c'), null);
  assert.deepEqual(deck.undoLast(), { status:'empty' });
});

test('owner-scoped undo cannot consume another question history deck action', () => {
  const deck = createHistoryDeckState();
  const suggestions = [suggestion('one', 100)];
  deck.keep({ questionId:'q1', historyId:'h1', suggestionId:'one', suggestions });
  deck.pass({ questionId:'q2', historyId:'h2', suggestionId:'one', suggestions });
  assert.equal(deck.canUndo({ questionId:'q1', historyId:'h1' }), false);
  assert.equal(deck.undoLast({ questionId:'q1', historyId:'h1' }).status, 'owner-mismatch');
  assert.equal(deck.getDisposition('q1', 'h1', 'one'), 'kept');
  assert.equal(deck.canUndo({ questionId:'q2', historyId:'h2' }), true);
  assert.equal(deck.undoLast({ questionId:'q2', historyId:'h2' }).status, 'undone');
  assert.equal(deck.getDisposition('q2', 'h2', 'one'), null);
  assert.equal(deck.canUndo({ questionId:'q1', historyId:'h1' }), true);
  assert.equal(deck.undoLast({ questionId:'q1', historyId:'h1' }).status, 'undone');
  assert.equal(deck.getDisposition('q1', 'h1', 'one'), null);
});

test('deck snapshot restores kept and passed dispositions per question/history', () => {
  const first = createHistoryDeckState();
  const suggestions = [suggestion('one', 100), suggestion('two', 200)];
  first.keep({ questionId:'q', historyId:'h', suggestionId:'one', suggestions });
  first.pass({ questionId:'q', historyId:'h', suggestionId:'two', suggestions });
  const restored = createHistoryDeckState({ snapshot:first.toSnapshot() });
  assert.equal(restored.getDisposition('q', 'h', 'one'), 'kept');
  assert.equal(restored.getDisposition('q', 'h', 'two'), 'passed');
  assert.deepEqual(restored.review({ questionId:'other-q', historyId:'h', suggestions }).unreviewedIds, ['one', 'two']);
  assert.throws(() => createHistoryDeckState({ maxKept:MAX_KEPT_SUGGESTIONS + 1 }), /keep limit/);
});
