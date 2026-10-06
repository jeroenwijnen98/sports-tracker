// @ts-check

import { localStart, localDay } from './startTime.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */

/** What an exercise without a usable start shows instead of a date. */
export const NO_START = 'Starttijd onbekend';

/**
 * The day an exercise started, read through the start time module.
 * e.g. "15 jan 2024", or `NO_START`.
 *
 * @param {Exercise} exercise
 * @returns {string}
 */
export function formatDate(exercise) {
  const local = localStart(exercise);
  if (local === null) return NO_START;
  return new Date(local).toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The time an exercise started, read through the start time module.
 * e.g. "08:30", or `NO_START`.
 *
 * @param {Exercise} exercise
 * @returns {string}
 */
export function formatTime(exercise) {
  const local = localStart(exercise);
  if (local === null) return NO_START;
  return new Date(local).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * Date and time together, as the run card and the detail view show them.
 * e.g. "15 jan 2024 · 08:30", or `NO_START` once.
 *
 * @param {Exercise} exercise
 * @returns {string}
 */
export function formatStart(exercise) {
  if (localStart(exercise) === null) return NO_START;
  return `${formatDate(exercise)} · ${formatTime(exercise)}`;
}

/**
 * "Vandaag", "Gisteren", else the date: calendar days in the browser's zone,
 * the exercise's day read as `localDay` reads it.
 *
 * @param {Exercise} exercise
 * @param {Date} [now]
 * @returns {string}
 */
export function relativeDay(exercise, now = new Date()) {
  const day = localDay(exercise);
  if (!day) return NO_START;
  const started = Date.UTC(day.year, day.month, day.day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today - started) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Vandaag';
  if (diffDays === 1) return 'Gisteren';
  return formatDate(exercise);
}
