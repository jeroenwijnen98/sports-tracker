import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeviceMap, importToast, importFiles } from '../public/js/import.js';
import { ingest } from '../public/js/intake.js';

/** @typedef {import('../types/domain.ts').Exercise} Exercise */
/** @typedef {import('../public/js/api.js').ImportedExercise} ImportedExercise */

const fixture = readFileSync(new URL('./fixtures/products-devices.json', import.meta.url), 'utf8');

test('parseDeviceMap names current devices and archived ones via their DELETE event', () => {
  assert.deepEqual(
    parseDeviceMap(fixture),
    new Map([
      ['AAAA0001', 'Polar Pacer'],
      ['BBBB0001', 'Polar Vantage M'],
    ]),
  );
});

test('parseDeviceMap yields an empty map for a malformed file', () => {
  assert.deepEqual(parseDeviceMap('{ not json'), new Map());
  assert.deepEqual(parseDeviceMap('null'), new Map());
  assert.deepEqual(parseDeviceMap('{"devices": 3}'), new Map());
  assert.deepEqual(parseDeviceMap('{}'), new Map());
});

test('importToast keeps the wording for imported, duplicate and overlap', () => {
  assert.deepEqual(importToast({ newExercises: 2, overlaps: 1, duplicates: 0, total: 5 }, 1), {
    message: '2 geïmporteerd, 1 duplicaat, 1 overlap gemarkeerd',
    type: 'success',
  });
  assert.deepEqual(importToast({ newExercises: 0, overlaps: 0, duplicates: 0, total: 5 }, 3), {
    message: '3 duplicaat',
    type: 'info',
  });
  assert.deepEqual(importToast({ newExercises: 0, overlaps: 0, duplicates: 0, total: 5 }, 0), {
    message: 'Geen hardloopactiviteiten gevonden in de bestanden',
    type: 'info',
  });
});

/**
 * A fake file, read the way a browser `File` is.
 * @param {string} name
 * @param {unknown} contents A string as it is, anything else as JSON.
 */
function file(name, contents) {
  const text = typeof contents === 'string' ? contents : JSON.stringify(contents);
  return { name, text: async () => text };
}

/**
 * A running exercise as an import route returns it.
 * @param {string} id
 * @param {Partial<ImportedExercise>} [fields]
 * @returns {ImportedExercise}
 */
function exercise(id, fields = {}) {
  return { id, 'start-time': '2000-01-01T08:00:00.000', duration: 'PT30M', distance: 5000, 'detailed-sport-info': 'RUNNING', ...fields };
}

/**
 * Fake adapters: each import route answers from a map keyed by the TCX text or
 * the session's `id`, and intake runs the real `ingest` against an empty store.
 * Records what each was called with.
 *
 * @param {{ tcx?: Record<string, ImportedExercise | Error>, json?: Record<string, ImportedExercise | Error> }} answers
 */
function adapters({ tcx = {}, json = {} }) {
  /** @type {{ tcx: string[], json: unknown[], ingested: Exercise[] }} */
  const calls = { tcx: [], json: [], ingested: [] };
  /** @param {ImportedExercise | Error | undefined} answer */
  const reply = async (answer) => {
    if (!answer || answer instanceof Error) throw answer ?? new Error('unexpected file');
    return answer;
  };
  return {
    calls,
    /** @param {string} xml */
    importTcx: (xml) => {
      calls.tcx.push(xml);
      return reply(tcx[xml]);
    },
    /** @param {any} session */
    importJson: (session) => {
      calls.json.push(session);
      return reply(json[session.id]);
    },
    /** @param {Exercise[]} incoming */
    ingestAndSave: async (incoming) => {
      calls.ingested = incoming;
      const { toSave, counts } = ingest(incoming, { existing: [], shoes: [] });
      return { counts, newIds: toSave.map((e) => e.id) };
    },
  };
}

/** Runs `fn` with `console.error` silenced, for the files expected to fail. */
async function quietly(/** @type {() => Promise<void>} */ fn) {
  const { error } = console;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = error;
  }
}

test('importFiles renames devices through the map, so an imported Beat + Pacer pair marks the Beat run as overlap', async () => {
  const fake = adapters({
    json: {
      s1: exercise('import-1', { device: 'Polar Beat' }),
      s2: exercise('import-2', { device: 'AAAA0001', 'start-time': '2000-01-01T08:01:00.000' }),
    },
  });
  const files = [
    file('training-session-1.json', { id: 's1', exercises: [{}] }),
    file('training-session-2.json', { id: 's2', exercises: [{}] }),
    file('products-devices-1.json', fixture),
  ];

  const { counts, duplicates, newIds } = await importFiles(files, fake);

  assert.deepEqual(fake.calls.ingested.map((e) => e.device), ['Polar Beat', 'Polar Pacer']);
  assert.deepEqual(newIds, ['import-1', 'import-2']);
  assert.equal(duplicates, 0);
  assert.equal(counts.overlaps, 1);
  assert.equal(importToast(counts, duplicates).message, '2 geïmporteerd, 1 overlap gemarkeerd');
});

test('importFiles sends .json files to the JSON import and every other file to the TCX import', async () => {
  const fake = adapters({
    tcx: { '<tcx-a/>': exercise('import-a'), '<tcx-b/>': exercise('import-b', { 'start-time': '2000-01-02T08:00:00.000' }) },
    json: { s1: exercise('import-c', { 'start-time': '2000-01-03T08:00:00.000' }) },
  });
  const files = [file('a.tcx', '<tcx-a/>'), file('session.json', { id: 's1', exercises: [{}] }), file('b.TCX', '<tcx-b/>')];

  const { newIds } = await importFiles(files, fake);

  assert.deepEqual(fake.calls.tcx, ['<tcx-a/>', '<tcx-b/>']);
  assert.deepEqual(fake.calls.json, [{ id: 's1', exercises: [{}] }]);
  assert.deepEqual(newIds, ['import-a', 'import-c', 'import-b']);
});

test('importFiles skips JSON without exercises, including the products-devices file', async () => {
  const fake = adapters({});
  const files = [
    file('activity-summary.json', { id: 'x', summary: {} }),
    file('heart-rate.json', { id: 'y', exercises: [] }),
    file('products-devices.json', fixture),
  ];

  const result = await importFiles(files, fake);

  assert.deepEqual(fake.calls.json, []);
  assert.deepEqual(fake.calls.tcx, []);
  assert.deepEqual(result.newIds, []);
  assert.equal(importToast(result.counts, result.duplicates).message, 'Geen hardloopactiviteiten gevonden in de bestanden');
});

test('importFiles keeps going when a file fails', async () => {
  const fake = adapters({
    tcx: { '<bad/>': new Error('Invalid TCX'), '<good/>': exercise('import-good') },
  });
  const files = [file('broken.json', '{ not json'), file('bad.tcx', '<bad/>'), file('good.tcx', '<good/>')];

  /** @type {string[]} */
  let newIds = [];
  await quietly(async () => {
    ({ newIds } = await importFiles(files, fake));
  });

  assert.deepEqual(fake.calls.tcx, ['<bad/>', '<good/>']);
  assert.deepEqual(newIds, ['import-good']);
});

test('importFiles counts the server duplicates and does not hand them to intake', async () => {
  const fake = adapters({
    tcx: {
      '<old-1/>': { ...exercise('import-old-1'), _duplicate: true },
      '<old-2/>': { ...exercise('import-old-2'), _duplicate: true },
      '<new/>': exercise('import-new', { 'start-time': '2000-01-05T08:00:00.000' }),
    },
  });
  const files = [file('1.tcx', '<old-1/>'), file('2.tcx', '<old-2/>'), file('3.tcx', '<new/>')];

  const { counts, duplicates } = await importFiles(files, fake);

  assert.equal(duplicates, 2);
  assert.deepEqual(fake.calls.ingested.map((e) => e.id), ['import-new']);
  assert.equal(importToast(counts, duplicates).message, '1 geïmporteerd, 2 duplicaat');
});

test('a newly imported exercise keeps the heart rate sensor the server classified', async () => {
  /** @type {import('../types/domain.ts').HeartRateSensor} */
  const hrSensor = { label: 'chest-strap', smoothness: 0.42 };
  const fake = adapters({ tcx: { '<run/>': exercise('import-hr', { hrSensor }) } });
  /** @type {Exercise[]} */
  let saved = [];
  const ingestAndSave = async (/** @type {Exercise[]} */ incoming) => {
    const result = ingest(incoming, { existing: [], shoes: [] });
    saved = result.toSave;
    return { counts: result.counts, newIds: result.toSave.map((e) => e.id) };
  };

  await importFiles([file('run.tcx', '<run/>')], { ...fake, ingestAndSave });

  assert.deepEqual(saved.find((e) => e.id === 'import-hr')?.hrSensor, hrSensor);
});
