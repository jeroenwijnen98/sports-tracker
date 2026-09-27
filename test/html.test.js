import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../public/js/utils/html.js';

test('escapeHtml turns markup in a device name into literal text', () => {
  assert.equal(escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
});

test('escapeHtml is safe inside a quoted attribute', () => {
  assert.equal(escapeHtml(`Nike "Pegasus" & 'Vomero'`), 'Nike &quot;Pegasus&quot; &amp; &#39;Vomero&#39;');
});

test('escapeHtml gives an empty string for missing values', () => {
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
});
