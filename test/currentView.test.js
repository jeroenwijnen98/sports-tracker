import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCurrentView } from '../public/js/utils/currentView.js';

test('the ticket of the open view is current', () => {
  const view = createCurrentView();
  const a = view.open('a');
  assert.equal(a.exerciseId, 'a');
  assert.equal(view.isCurrent(a), true);
});

test('opening another exercise makes the earlier ticket stale', () => {
  const view = createCurrentView();
  const a = view.open('a');
  const b = view.open('b');
  assert.equal(view.isCurrent(a), false);
  assert.equal(view.isCurrent(b), true);
});

test('closing the view makes its ticket stale', () => {
  const view = createCurrentView();
  const a = view.open('a');
  view.close();
  assert.equal(view.isCurrent(a), false);
});

test('reopening the same exercise makes the first opening stale', () => {
  const view = createCurrentView();
  const first = view.open('a');
  view.close();
  const second = view.open('a');
  assert.equal(view.isCurrent(first), false);
  assert.equal(view.isCurrent(second), true);
});
