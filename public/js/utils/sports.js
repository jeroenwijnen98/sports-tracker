/**
 * The running sports — the only sports this dashboard stores and shows — with
 * their display names. Also imported by the server, so both sides agree on
 * what counts as running.
 */
export const RUNNING_SPORT_LABELS = {
  RUNNING: 'Run',
  TRAIL_RUNNING: 'Trail Run',
  TREADMILL_RUNNING: 'Treadmill',
  ULTRARUNNING_RUNNING: 'Ultra Run',
};

export const RUNNING_SPORTS = Object.keys(RUNNING_SPORT_LABELS);

export function isRunningSport(exercise) {
  return RUNNING_SPORTS.includes(exercise['detailed-sport-info']);
}
