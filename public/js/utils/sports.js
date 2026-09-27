// @ts-check

/** @typedef {import('../../../types/domain.ts').RunningSport} RunningSport */

/**
 * The running sports — the only sports this dashboard stores and shows — with
 * their display names. Also imported by the server, so both sides agree on
 * what counts as running.
 *
 * @type {Record<RunningSport, string>}
 */
export const RUNNING_SPORT_LABELS = {
  RUNNING: 'Run',
  TRAIL_RUNNING: 'Trail Run',
  TREADMILL_RUNNING: 'Treadmill',
  ULTRARUNNING_RUNNING: 'Ultra Run',
};

export const RUNNING_SPORTS = /** @type {RunningSport[]} */ (Object.keys(RUNNING_SPORT_LABELS));

/**
 * @param {string | undefined} sport A `detailed-sport-info` value.
 * @returns {sport is RunningSport}
 */
export function isRunningSportName(sport) {
  return RUNNING_SPORTS.includes(/** @type {RunningSport} */ (sport));
}

/**
 * @param {{ 'detailed-sport-info'?: string }} exercise
 * @returns {boolean}
 */
export function isRunningSport(exercise) {
  return isRunningSportName(exercise['detailed-sport-info']);
}
