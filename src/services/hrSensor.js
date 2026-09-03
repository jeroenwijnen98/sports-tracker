import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'data', 'hrSensor.json');

/**
 * Infers whether an exercise was recorded with a chest strap or with the
 * watch's wrist sensor, from the texture of its 1 Hz heart rate series.
 *
 * A chest strap derives every value from an actual R-R interval, so the series
 * keeps visible sample-to-sample texture. Optical wrist measurement is heavily
 * filtered before it is written, so consecutive values repeat far more often
 * and the average step between samples is smaller. Neither Polar's TCX nor its
 * AccessLink JSON records which sensor was used — `device`/`device-id` name the
 * recording watch or phone, not the heart rate source — so texture is the only
 * signal available.
 *
 * CALIBRATION AND ITS LIMITS. The reference distribution below comes from 53
 * Polar Beat exercises, which are necessarily chest strap recordings because
 * the phone app has no sensor of its own. The only confirmed wrist recording is
 * a single run (2026-09-03), which scores at the 98th percentile of that strap
 * distribution — the features point the right way, but one positive example
 * cannot establish an error rate. At the threshold used here, 21% of the Pacer
 * exercises come out as wrist, spread over the years in a pattern that does not
 * look like a clean switch. Treat a per-run label as an indication, not a fact,
 * and read `smoothness` rather than `label` when it matters.
 *
 * Recalibrate RECALIBRATE_ME below once more runs have a confirmed sensor.
 */

// Fitted over the 265 cached running TCX files. `mad` rises with how variable
// and how high the heart rate was, so it is corrected before being compared.
const MAD_FIT = { sd: 0.012293, mean: -0.001108, intercept: 0.490423 };

// RECALIBRATE_ME: mean and standard deviation over the 53 known chest strap runs.
const STRAP_REFERENCE = {
  repeat: { mean: 0.6702, sd: 0.054 },
  madResidual: { mean: -0.0037, sd: 0.2131 },
};

// 95th percentile of the strap reference: a run this smooth would be an unusual
// chest strap recording. The lower bound is deliberately loose — being rougher
// than the strap median is weak evidence, so most runs land on 'unknown'.
const WRIST_THRESHOLD = 1.02;
const STRAP_THRESHOLD = -0.5;

const MIN_SAMPLES = 300;
const WARMUP_SAMPLES = 120;

const TRACKPOINT_RE = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
const HR_RE = /<HeartRateBpm[^>]*>\s*<Value>(\d+)<\/Value>/;
const DISTANCE_RE = /<DistanceMeters>([\d.]+)<\/DistanceMeters>/;
const CADENCE_RE = /<Cadence>(\d+)<\/Cadence>/;

/**
 * Pull the heart rate series out of a TCX, keeping only trackpoints that
 * actually carry a heart rate. Polar interleaves position-only trackpoints
 * that would otherwise show up as gaps.
 */
function readSeries(xml) {
  const hr = [];
  const distance = [];
  const cadence = [];

  TRACKPOINT_RE.lastIndex = 0;
  let match;
  while ((match = TRACKPOINT_RE.exec(xml)) !== null) {
    const body = match[1];
    const hrMatch = body.match(HR_RE);
    if (!hrMatch) continue;

    hr.push(Number(hrMatch[1]));
    const distMatch = body.match(DISTANCE_RE);
    distance.push(distMatch ? Number(distMatch[1]) : null);
    const cadMatch = body.match(CADENCE_RE);
    cadence.push(cadMatch ? Number(cadMatch[1]) : null);
  }

  return { hr, distance, cadence };
}

/**
 * Mask out everything that is not steady running: standing still distorts the
 * texture, and the first two minutes are dominated by the sensor settling.
 */
function movingMask({ hr, distance, cadence }) {
  const n = hr.length;
  const withDistance = distance.filter((d) => d !== null).length / n;
  const withCadence = cadence.filter((c) => c !== null).length / n;

  let moving;
  if (withDistance > 0.8) {
    // Distance is monotonic in principle but Polar occasionally steps back.
    const cumulative = [];
    let peak = 0;
    for (const d of distance) {
      peak = Math.max(peak, d ?? peak);
      cumulative.push(peak);
    }
    moving = cumulative.map((_, i) => {
      const prev = cumulative[Math.max(0, i - 1)];
      const next = cumulative[Math.min(n - 1, i + 1)];
      const span = Math.min(n - 1, i + 1) - Math.max(0, i - 1);
      return span > 0 && (next - prev) / span > 1.4;
    });
  } else if (withCadence > 0.8) {
    moving = cadence.map((c) => c !== null && c >= 140);
  } else {
    moving = new Array(n).fill(true);
  }

  const indices = [];
  for (let i = WARMUP_SAMPLES; i < n; i++) {
    if (moving[i]) indices.push(i);
  }
  // Treadmill and indoor runs sometimes carry neither usable signal; rather
  // than discard them, fall back to everything past the warmup.
  if (indices.length < MIN_SAMPLES) {
    const fallback = [];
    for (let i = WARMUP_SAMPLES; i < n; i++) fallback.push(i);
    return fallback;
  }
  return indices;
}

/**
 * Texture features for one exercise, or null when the TCX is too short or
 * carries no usable heart rate.
 */
export function analyseHrTexture(xml) {
  const series = readSeries(xml);
  if (series.hr.length < MIN_SAMPLES + WARMUP_SAMPLES) return null;

  const indices = movingMask(series);
  if (indices.length < MIN_SAMPLES) return null;

  const hr = indices.map((i) => series.hr[i]);
  const mean = hr.reduce((a, b) => a + b, 0) / hr.length;
  const sd = Math.sqrt(hr.reduce((a, b) => a + (b - mean) ** 2, 0) / hr.length);
  if (!(sd > 0)) return null;

  let repeats = 0;
  let absoluteStep = 0;
  for (let i = 1; i < hr.length; i++) {
    const step = Math.abs(hr[i] - hr[i - 1]);
    if (step === 0) repeats++;
    absoluteStep += step;
  }
  const repeat = repeats / (hr.length - 1);
  const mad = absoluteStep / (hr.length - 1);

  const madExpected = MAD_FIT.sd * sd + MAD_FIT.mean * mean + MAD_FIT.intercept;
  return {
    samples: hr.length,
    meanHr: Number(mean.toFixed(1)),
    sdHr: Number(sd.toFixed(2)),
    repeat: Number(repeat.toFixed(4)),
    mad: Number(mad.toFixed(4)),
    madResidual: Number((mad - madExpected).toFixed(4)),
  };
}

/**
 * Classify one exercise's TCX. `smoothness` is the number of strap-reference
 * standard deviations towards wrist-like: positive is smoother than a typical
 * chest strap recording, negative is rougher.
 */
export function classifyHrSensor(xml) {
  const features = analyseHrTexture(xml);
  if (!features) return null;

  const repeatZ =
    (features.repeat - STRAP_REFERENCE.repeat.mean) / STRAP_REFERENCE.repeat.sd;
  const madZ =
    (features.madResidual - STRAP_REFERENCE.madResidual.mean) /
    STRAP_REFERENCE.madResidual.sd;
  const smoothness = (repeatZ - madZ) / 2;

  let label = 'unknown';
  if (smoothness >= WRIST_THRESHOLD) label = 'wrist';
  else if (smoothness <= STRAP_THRESHOLD) label = 'chest-strap';

  return {
    label,
    smoothness: Number(smoothness.toFixed(2)),
    // One confirmed wrist recording underpins this, so nothing here is better
    // than indicative; the margin only says how far from the dead band it sits.
    confidence: Math.abs(smoothness) >= 2 ? 'moderate' : 'low',
    features,
  };
}

export async function readSensorCache() {
  try {
    return JSON.parse(await readFile(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export async function writeSensorCache(map) {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(map, null, 2));
}

/**
 * Classify and persist one exercise. Returns the result, or null when the TCX
 * has too little usable heart rate data.
 */
export async function recordHrSensor(exerciseId, xml) {
  const result = classifyHrSensor(xml);
  if (!result) return null;

  const map = await readSensorCache();
  map[exerciseId] = result;
  await writeSensorCache(map);
  return result;
}

/**
 * Attach stored sensor labels to a list of exercises, without overwriting a
 * field the exercise already carries.
 */
export async function withHrSensor(exercises) {
  const map = await readSensorCache();
  return exercises.map((exercise) => {
    const sensor = map[exercise.id];
    return sensor ? { ...exercise, hrSensor: sensor } : exercise;
  });
}
