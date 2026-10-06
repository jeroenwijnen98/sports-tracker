// @ts-check

import { localDay } from './startTime.js';

/** @typedef {import('../../../types/domain.ts').Exercise} Exercise */
/** @typedef {import('./startTime.js').LocalDay} LocalDay */

/** @typedef {'W' | 'M' | 'Y' | 'All'} Mode */

/**
 * One bar of the chart: the kilometres run in one day, week, month or year.
 * @typedef {{ km: number, label: string, key?: string, year?: number }} Bar
 */

/** @typedef {{ filtered: Exercise[], bars: Bar[], periodLabel: string }} PeriodData */

/** @typedef {{ ex: Exercise, day: LocalDay }} Dated */

const MONTH_LABELS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTH_NAMES = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const DAY_LABELS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The activity chart's numbers for one mode, no DOM: the exercises in the
 * period, its bars and its label. Every period reads an exercise's day through
 * `localDay`; an exercise without a start is in no period.
 *
 * @param {Mode} mode
 * @param {Exercise[]} exercises
 * @param {Date} now
 * @returns {PeriodData}
 */
export function periodData(mode, exercises, now) {
  /** @type {Dated[]} */
  const dated = [];
  for (const ex of exercises) {
    const day = localDay(ex);
    if (day) dated.push({ ex, day });
  }
  switch (mode) {
    case 'W':
      return buildWeekData(dated, now);
    case 'M':
      return buildMonthData(dated, now);
    case 'Y':
      return buildYearData(dated, now);
    default:
      return buildAllData(dated, now);
  }
}

/**
 * A calendar day as a number that orders and steps by days (midnight UTC).
 *
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {number}
 */
const dayNumber = (year, month, day) => Date.UTC(year, month, day);

/** @type {(ex: Exercise) => number} */
const km = (ex) => (ex.distance || 0) / 1000;

/**
 * @param {Dated[]} dated
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildWeekData(dated, now) {
  const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const monday = dayNumber(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  const sunday = monday + 6 * DAY_MS;

  const bars = DAY_LABELS.map((label) => ({ km: 0, label }));
  /** @type {Exercise[]} */
  const filtered = [];
  for (const { ex, day } of dated) {
    const n = dayNumber(day.year, day.month, day.day);
    if (n < monday || n > sunday) continue;
    filtered.push(ex);
    bars[(n - monday) / DAY_MS].km += km(ex);
  }

  return { filtered, bars, periodLabel: 'Deze week' };
}

/**
 * @param {Dated[]} dated
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildMonthData(dated, now) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  /** @type {number[]} */
  const starts = [];
  for (let d = 1; d <= daysInMonth; d += 7) starts.push(d);

  /** @type {Bar[]} */
  const bars = starts.map((start) => ({ km: 0, label: String(start) }));
  /** @type {Exercise[]} */
  const filtered = [];
  for (const { ex, day } of dated) {
    if (day.year !== year || day.month !== month) continue;
    filtered.push(ex);
    bars[Math.floor((day.day - 1) / 7)].km += km(ex);
  }

  const name = MONTH_NAMES[month];
  return { filtered, bars, periodLabel: `${name.charAt(0).toUpperCase() + name.slice(1)} ${year}` };
}

/**
 * @param {Dated[]} dated
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildYearData(dated, now) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  /** @type {Bar[]} */
  const bars = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(currentYear, currentMonth - 11 + i, 1);
    bars.push({ km: 0, label: MONTH_LABELS[d.getMonth()], key: monthKey(d.getFullYear(), d.getMonth()) });
  }

  /** @type {Exercise[]} */
  const filtered = [];
  for (const { ex, day } of dated) {
    const bar = bars.find((b) => b.key === monthKey(day.year, day.month));
    if (!bar) continue;
    filtered.push(ex);
    bar.km += km(ex);
  }

  const startMonth = new Date(currentYear, currentMonth - 11, 1);
  const periodLabel = `${MONTH_LABELS[startMonth.getMonth()]} ${startMonth.getFullYear()} – ${MONTH_LABELS[currentMonth]} ${currentYear}`;

  return { filtered, bars, periodLabel };
}

/**
 * @param {number} year
 * @param {number} month
 * @returns {string}
 */
const monthKey = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;

/**
 * @param {Dated[]} dated
 * @param {Date} now
 * @returns {PeriodData}
 */
function buildAllData(dated, now) {
  if (dated.length === 0) {
    const y = now.getFullYear();
    return { filtered: [], bars: [{ km: 0, label: String(y) }], periodLabel: String(y) };
  }

  const years = dated.map(({ day }) => day.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years, now.getFullYear());

  /** @type {Bar[]} */
  const bars = [];
  for (let y = minYear; y <= maxYear; y++) {
    bars.push({ km: 0, label: String(y), year: y });
  }
  for (const { ex, day } of dated) {
    bars[day.year - minYear].km += km(ex);
  }

  const periodLabel = minYear === maxYear ? String(minYear) : `${minYear}–${maxYear}`;

  return { filtered: dated.map(({ ex }) => ex), bars, periodLabel };
}
