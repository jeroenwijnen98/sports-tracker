import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let dir;
/** @type {typeof import('../src/services/xmlCache.ts')} */
let xmlCache;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sports-tracker-'));
  process.env.SPORTS_DATA_DIR = dir;
  // Imported only now, so the store resolves its path from the temp directory
  xmlCache = await import('../src/services/xmlCache.ts');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('isXmlType accepts tcx and gpx only', () => {
  assert.equal(xmlCache.isXmlType('tcx'), true);
  assert.equal(xmlCache.isXmlType('gpx'), true);
  assert.equal(xmlCache.isXmlType('fit'), false);
  assert.equal(xmlCache.isXmlType('TCX'), false);
  // A prototype key is not an XML type, although XML_ACCEPT[type] would find it
  assert.equal(xmlCache.isXmlType('toString'), false);
});
