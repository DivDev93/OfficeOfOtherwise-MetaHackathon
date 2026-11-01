import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAtlasScreenLabelButton, isAtlasScreenLabelAction } from '../web/atlas/screenLabelActions.js';

class FakeButton {
  listeners = new Map();
  focused = false;
  type = '';
  tabIndex = -1;
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener); this.listeners.set(type, listeners);
  }
  matches(selector) { return selector === ':focus' && this.focused; }
  dispatch(type, values = {}) {
    const event = { type, target:this, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

test('only world, question, chip, and present-day titles are actionable labels', () => {
  for (const kind of ['world', 'question', 'chip', 'present']) assert.equal(isAtlasScreenLabelAction(kind), true);
  for (const kind of ['axis', 'tick', 'auxiliary']) assert.equal(isAtlasScreenLabelAction(kind), false);
});

test('actionable labels preview on pointer and keyboard focus, activate, and clear after leaving', () => {
  const button = new FakeButton();
  const previews = [], activations = [];
  bindAtlasScreenLabelButton(button, {
    onPreview:(source, event) => previews.push([source, event.type]),
    onActivate:event => activations.push(event.detail),
  });
  assert.equal(button.type, 'button');
  assert.equal(button.tabIndex, 0);
  button.dispatch('pointerenter', { clientX:123, clientY:45 });
  button.dispatch('pointerleave');
  button.focused = true;
  button.dispatch('focus');
  button.dispatch('pointerenter');
  button.dispatch('pointerleave');
  button.dispatch('click', { detail:0 });
  const escape = button.dispatch('keydown', { key:'Escape' });
  button.focused = false;
  button.dispatch('blur');
  assert.deepEqual(previews, [
    ['pointer', 'pointerenter'], [null, 'pointerleave'], ['keyboard', 'focus'],
    ['pointer', 'pointerenter'], [null, 'keydown'], [null, 'blur'],
  ]);
  assert.deepEqual(activations, [0], 'native keyboard-generated button clicks use the same activation path');
  assert.equal(escape.defaultPrevented, true);
});
