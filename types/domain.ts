/**
 * Shared domain types, one source for the server and the browser. The names
 * follow CONTEXT.md. Types only: Node strips this file to nothing, and
 * frontend files reference it through a JSDoc `@typedef` of
 * `import('../../types/domain.ts').Exercise`, so the browser never loads it.
 */

// ─── Runs ────────────────────────────────────────────────────────────────────

/** The sports this dashboard keeps. Exercises in any other sport are not shown. */
export type RunningSport =
  | 'RUNNING'
  | 'TRAIL_RUNNING'
  | 'TREADMILL_RUNNING'
  | 'ULTRARUNNING_RUNNING';

/**
 * One recorded session, as Polar hands it over or as an import builds it.
 * Polar's hyphenated fields keep their names: read them with bracket notation
 * and never use them as an IndexedDB key path or index.
 *
 * The server caches exercises of every sport; `detailed-sport-info` is a
 * RunningSport for everything the frontend stores.
 */
export interface Exercise {
  /** Polar's exercise id, or `import-…` for an imported exercise. */
  id: string;
  /** Local start time, ISO 8601 without offset (e.g. `2026-09-03T07:12:00`). */
  'start-time': string;
  'start-time-utc-offset'?: number;
  'upload-time'?: string;
  /** ISO 8601 duration, e.g. `PT1H2M3S` or `PT3723.5S`. */
  duration: string;
  /** Metres. */
  distance?: number;
  calories?: number;
  'heart-rate'?: { average?: number; maximum?: number };
  sport?: string;
  'detailed-sport-info': RunningSport | (string & {});
  /**
   * The recording device (e.g. `Polar Pacer`, `Polar Beat`), not the heart
   * rate source. Missing or `Polar Beat` means the phone app recorded it.
   */
  device?: string;
  'device-id'?: string;
  'has-route'?: boolean;
  'training-load'?: number;
  'polar-user'?: string;
  'transaction-id'?: number;
  'resource-uri'?: string;
  /** How an imported exercise came in; absent for exercises synced from Polar. */
  source?: 'tcx-import' | 'json-import';

  /** Inferred on the server from the TCX and carried along by the exercises endpoints. */
  hrSensor?: HeartRateSensor;

  // Set only in the browser (IndexedDB).
  /** The shoe this exercise was run in. */
  shoeId?: number;
  /** A second recording of a run another device also recorded; not counted in totals. */
  overlap?: boolean;
}

/** One segment of an exercise as the watch split it. */
export interface Lap {
  /** 1-based. */
  index: number;
  /** Seconds. */
  duration: number | null;
  /** Metres. */
  distance: number | null;
  avgHR: number | null;
  maxHR: number | null;
}

/** A single sample within an exercise. */
export interface Trackpoint {
  /** ISO 8601 timestamp. */
  time: string | null;
  lat: number | null;
  lon: number | null;
  heartRate: number | null;
  /** Metres per second. */
  speed: number | null;
  /** Cumulative metres since the start. */
  distance: number | null;
}

/** A GPS coordinate as `[latitude, longitude]`. */
export type LatLon = [lat: number, lon: number];

/** The GPS line an exercise was run along; empty for treadmill and indoor runs. */
export type Route = LatLon[];

/** The per-run trace, parsed from TCX (or from GPX, which only has a route). */
export interface DetailData {
  laps: Lap[];
  allTrackpoints: Trackpoint[];
  route: Route;
  hasGps: boolean;
  hasHeartRate: boolean;
  hasSpeed: boolean;
}

// ─── Heart rate ──────────────────────────────────────────────────────────────

/**
 * How filtered an exercise's heart rate series looks, in chest strap reference
 * standard deviations. Higher is more wrist-like. Reason with this, not the label.
 */
export type Smoothness = number;

/** The rounded form of smoothness. */
export type HeartRateSensorLabel = 'chest-strap' | 'wrist' | 'unknown';

/** Texture of the 1 Hz heart rate series that smoothness is computed from. */
export interface HeartRateTexture {
  /** Heart rate samples used, taken while moving. */
  samples: number;
  meanHr: number;
  sdHr: number;
  /** Share of steps that repeat the previous value. */
  repeat: number;
  /** Mean absolute step between consecutive samples. */
  mad: number;
  /** `mad` minus what a chest strap would show at this mean and spread. */
  madResidual: number;
}

/** The inferred heart rate sensor of one exercise: an indication, not a fact. */
export interface HeartRateSensor {
  label: HeartRateSensorLabel;
  smoothness: Smoothness;
  /** Stored by the classifier; only how far smoothness sits from the dead band. */
  confidence?: 'low' | 'moderate';
  features?: HeartRateTexture;
}

// ─── Shoes ───────────────────────────────────────────────────────────────────

/** A pair of running shoes that exercises are assigned to. */
export interface Shoe {
  /** IndexedDB auto-increment key; absent until the shoe is first stored. */
  id?: number;
  name: string;
  brand?: string;
  /** Kilometres run before the shoe was entered here. */
  initialKm: number;
  /** Exactly one shoe is the default shoe. */
  isDefault: boolean;
}
