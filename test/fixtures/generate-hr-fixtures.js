/**
 * Writes the synthetic TCX fixtures for the heart rate sensor tests. They are
 * generated rather than cut from real runs, so they carry no route and no
 * personal data. Seeded, so rerunning gives byte-identical files:
 *
 *   node test/fixtures/generate-hr-fixtures.js
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// mulberry32: small deterministic PRNG
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tcx(hr) {
  const start = Date.UTC(2000, 0, 1, 8, 0, 0);
  const trackpoints = hr.map((bpm, i) => [
    '            <Trackpoint>',
    `              <Time>${new Date(start + i * 1000).toISOString()}</Time>`,
    `              <DistanceMeters>${(i * 3).toFixed(1)}</DistanceMeters>`,
    `              <HeartRateBpm><Value>${bpm}</Value></HeartRateBpm>`,
    '            </Trackpoint>',
  ].join('\n')).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>${new Date(start).toISOString()}</Id>
        <Lap StartTime="${new Date(start).toISOString()}">
          <TotalTimeSeconds>${hr.length}</TotalTimeSeconds>
          <DistanceMeters>${hr.length * 3}</DistanceMeters>
          <Track>
${trackpoints}
          </Track>
        </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

// Slow drift from 130 towards 160 bpm, shared by both recordings.
function drift(i) {
  return 130 + 30 * (1 - Math.exp(-i / 300)) + 3 * Math.sin(i / 40);
}

// Chest strap: beat-to-beat jitter around the drift, rounded each second.
function strapSeries(n, random) {
  return Array.from({ length: n }, (_, i) => Math.round(drift(i) + (random() - 0.5) * 1.6));
}

// Wrist: the same drift, heavily smoothed and only updated every few seconds.
function wristSeries(n, random) {
  const hr = [];
  let value = Math.round(drift(0));
  for (let i = 0; i < n; i++) {
    if (random() < 0.12) value = Math.round(drift(i));
    hr.push(value);
  }
  return hr;
}

const N = 600;
writeFileSync(join(__dirname, 'hr-strap.tcx'), tcx(strapSeries(N, rng(1))));
writeFileSync(join(__dirname, 'hr-wrist.tcx'), tcx(wristSeries(N, rng(2))));
// Too short for the classifier: it must decline rather than guess.
writeFileSync(join(__dirname, 'hr-short.tcx'), tcx(strapSeries(200, rng(3))));
