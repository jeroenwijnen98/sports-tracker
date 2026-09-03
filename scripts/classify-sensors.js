/**
 * Classifies the heart rate sensor for every cached TCX and writes the result
 * to src/data/hrSensor.json.
 *
 * Safe to re-run: it rebuilds the whole map from the cached TCX files, which
 * are the permanent record. Pass --verbose to list every exercise.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyHrSensor, writeSensorCache } from '../src/services/hrSensor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TCX_DIR = join(__dirname, '..', 'src', 'data', 'tcx');

async function main() {
  const verbose = process.argv.includes('--verbose');

  let files;
  try {
    files = (await readdir(TCX_DIR)).filter((f) => f.endsWith('.xml'));
  } catch {
    console.log('[sensors] No cached TCX directory — nothing to classify');
    return;
  }

  const map = {};
  const counts = { 'chest-strap': 0, wrist: 0, unknown: 0 };
  let skipped = 0;

  for (const file of files.sort()) {
    const id = file.slice(0, -4);
    const xml = await readFile(join(TCX_DIR, file), 'utf-8');
    const result = classifyHrSensor(xml);
    if (!result) {
      skipped++;
      continue;
    }
    map[id] = result;
    counts[result.label]++;
    if (verbose) {
      console.log(
        `  ${id}  ${result.label.padEnd(11)} smoothness ${String(result.smoothness).padStart(6)}  (${result.features.samples} samples)`
      );
    }
  }

  await writeSensorCache(map);

  console.log(`[sensors] Classified ${Object.keys(map).length} of ${files.length} cached TCX files`);
  console.log(`[sensors]   chest-strap ${counts['chest-strap']}`);
  console.log(`[sensors]   wrist       ${counts.wrist}`);
  console.log(`[sensors]   unknown     ${counts.unknown}`);
  if (skipped > 0) {
    console.log(`[sensors]   skipped     ${skipped} (too short or no usable heart rate)`);
  }
}

main().catch((err) => {
  console.error('[sensors] Error:', err.message);
  process.exit(1);
});
