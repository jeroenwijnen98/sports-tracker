import type { Exercise, HeartRateSensor } from '../../types/domain.ts';
import { readCache, appendToCache, revertAppend } from './exerciseCache.ts';
import { writeXmlCache } from './xmlCache.ts';
import { withHrSensor } from './hrSensor.ts';
import { polarJsonToTcx, polarJsonToExercise, extractTcxMetadata } from './importConverters.ts';
import type { ExportSession } from './importConverters.ts';

/** What an import route hands over: an uploaded TCX, or a Polar data export training session. */
export type ImportSource =
  | { kind: 'tcx'; xml: string }
  | { kind: 'json'; session: ExportSession };

export interface ImportResult {
  /** `duplicate`: an exercise with this id is already stored, and nothing was written. */
  status: 'imported' | 'duplicate';
  /** The imported exercise, or for a duplicate the stored one, with its heart rate sensor when known. */
  exercise: Exercise;
}

/** Where an import is secured. */
export interface ImportStore {
  /** The stored exercise with this id, with its heart rate sensor attached. */
  findExercise(id: string): Promise<Exercise | undefined>;
  saveExercise(exercise: Exercise): Promise<void>;
  /** Undo `saveExercise`, for when the TCX cannot be written after it. */
  removeExercise(id: string): Promise<void>;
  /** Write the TCX; returns the heart rate sensor classified from it, if any. */
  writeTcx(exerciseId: string, xml: string): Promise<HeartRateSensor | null>;
}

/** The real store: the exercise cache plus the XML cache. */
export const diskImportStore: ImportStore = {
  async findExercise(id) {
    const found = (await readCache()).find((e) => e.id === id);
    return found && (await withHrSensor([found]))[0];
  },
  async saveExercise(exercise) {
    await appendToCache([exercise]);
  },
  removeExercise: revertAppend,
  writeTcx: (exerciseId, xml) => writeXmlCache('tcx', exerciseId, xml),
};

/** The exercise and the TCX to store for it. */
function convert(source: ImportSource): { exercise: Exercise; tcx: string } {
  switch (source.kind) {
    case 'tcx':
      // A TCX without <Id> is stored with a null start time, as it always was
      return { exercise: extractTcxMetadata(source.xml) as Exercise, tcx: source.xml };
    case 'json':
      return { exercise: polarJsonToExercise(source.session), tcx: polarJsonToTcx(source.session) };
  }
}

/**
 * Import one exercise from a TCX or a Polar data export session.
 *
 * An id already stored is a duplicate and nothing is written. Otherwise the
 * exercise and its TCX are secured together: the exercise first, so a failed
 * write of it leaves nothing on disk, then the TCX, and when that fails the
 * exercise is taken back out. That order never removes a TCX, which may be
 * the permanent record of an exercise deleted earlier.
 */
export async function importExercise(source: ImportSource, store: ImportStore): Promise<ImportResult> {
  const { exercise, tcx } = convert(source);
  const stored = await store.findExercise(exercise.id);
  if (stored) return { status: 'duplicate', exercise: stored };

  await store.saveExercise(exercise);
  let hrSensor: HeartRateSensor | null;
  try {
    hrSensor = await store.writeTcx(exercise.id, tcx);
  } catch (err) {
    await store.removeExercise(exercise.id);
    throw err;
  }

  return { status: 'imported', exercise: hrSensor ? { ...exercise, hrSensor } : exercise };
}
