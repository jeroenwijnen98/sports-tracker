// Comment width, enforced instead of remembered.
//
// Rewrapping comments was a commit the reviewer kept making by hand, to the
// width the rest of the code already used. That width, measured over the
// prose of every comment line: lines of comments that wrap sit at 80 columns
// or less (95th percentile 78, 97th 79, then a cliff), and one-line comments,
// which sit beside code, run longer (95th percentile 83, 99th 91). So a
// comment that wraps wraps at 80, and a one-line comment fits in 100.
//
// What cannot be wrapped passes: a URL that ends the line, a tool directive
// (oxlint-, @ts-expect-error), and a JSDoc type such as `@param {...} name`,
// which TypeScript checks as code. Prose after the type still counts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.join(import.meta.dirname, '..');

/** The width a comment that runs over more than one line wraps at. */
const WRAPPED = 80;
/** The width of a comment on one line of its own. */
const ONE_LINE = 100;

/** Not written here: the captured fixtures and the Sandcastle scaffold. */
const NOT_OURS = /^(test\/fixtures|\.sandcastle)\//;

/** A URL that runs past the limit and ends the line, but for closing marks. */
const URL_TAIL = /https?:\/\/\S*?[\s)\]>.,;:'"`]*(\*\/)?\s*$/;

/** A comment that tells a tool what to do, which has to stay on its line. */
const DIRECTIVE = /oxlint-|@ts-expect-error/;

/** A JSDoc tag followed by the opening brace of its type. */
const TYPE_TAG = /@(type|typedef|param|property|returns?|template|satisfies)\s*\{/;

/** @typedef {'wrapped' | 'one-line' | null} CommentKind */

/**
 * Each whole-line comment line too wide, as `line: why`, 1-based.
 * @param {string} source
 * @returns {string[]}
 */
function tooWide(source) {
  const lines = source.split('\n');
  const kinds = commentLines(lines);
  /** @type {string[]} */
  const complaints = [];
  lines.forEach((line, i) => {
    const kind = kinds[i];
    if (kind === null) return;
    const limit = kind === 'wrapped' ? WRAPPED : ONE_LINE;
    if (width(line) <= limit || unwrappable(line, limit)) return;
    complaints.push(`${i + 1}: ${width(line)} columns, over ${limit} for a ${kind} comment`);
  });
  return complaints;
}

/**
 * For each line, whether it is part of a comment that wraps, a comment on one
 * line of its own, or neither. A block comment wraps when it spans lines; `//`
 * lines wrap when two or more follow one another. A comment after code on the
 * same line is the code's width, not a comment's.
 * @param {string[]} lines
 * @returns {CommentKind[]}
 */
function commentLines(lines) {
  /** @type {CommentKind[]} */
  const kinds = lines.map(() => null);
  /** @param {number} i */
  const slashes = (i) => lines[i]?.trimStart().startsWith('//') ?? false;
  let inBlock = false;
  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    if (inBlock) {
      kinds[i] = 'wrapped';
      inBlock = !line.includes('*/');
    } else if (trimmed.startsWith('/*')) {
      if (trimmed.includes('*/', 2)) {
        kinds[i] = 'one-line';
      } else {
        kinds[i] = 'wrapped';
        inBlock = true;
      }
    } else if (slashes(i)) {
      kinds[i] = slashes(i - 1) || slashes(i + 1) ? 'wrapped' : 'one-line';
    }
  });
  return kinds;
}

/**
 * Whether a line runs over only by what cannot move to the next line.
 * @param {string} line
 * @param {number} limit
 */
function unwrappable(line, limit) {
  if (DIRECTIVE.test(line)) return true;
  const url = URL_TAIL.exec(line);
  if (url !== null && width(line.slice(0, url.index)) <= limit) return true;
  const typeEnd = jsdocTypeEnd(line);
  return typeEnd !== null && /^\s*(\*\/)?\s*$/.test(line.slice(typeEnd));
}

/**
 * Where a JSDoc tag's type, and the name that follows it, end; null when the
 * line has no such tag. A type that does not close on this line runs to its
 * end.
 * @param {string} line
 * @returns {number | null}
 */
function jsdocTypeEnd(line) {
  const tag = TYPE_TAG.exec(line);
  if (tag === null) return null;
  let depth = 0;
  let end = tag.index + tag[0].length - 1;
  for (; end < line.length; end++) {
    if (line[end] === '{') depth++;
    else if (line[end] === '}' && --depth === 0) break;
  }
  if (depth !== 0) return line.length;
  end++;
  if (['typedef', 'param', 'property'].includes(tag[1])) {
    const name = /^\s*(\[[^\]]*\]|\S+)/.exec(line.slice(end));
    if (name !== null) end += name[0].length;
  }
  return end;
}

/**
 * Columns, counting a character outside the BMP (an emoji, say) as one.
 * @param {string} text
 */
function width(text) {
  return Array.from(text).length;
}

/** The repo's own source and tests that hold comments. */
function sourceFiles() {
  const listed = execFileSync('git', ['ls-files', '*.ts', '*.mts', '*.mjs', '*.js', '*.css'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return listed.split('\n').filter((file) => file !== '' && !NOT_OURS.test(file));
}

test('a comment that wraps past 80 columns, or one line past 100, is rejected', () => {
  const wrapped = ['/**', ` * ${'word '.repeat(16)}word`, ' */'].join('\n');
  assert.deepEqual(tooWide(wrapped), ['2: 87 columns, over 80 for a wrapped comment']);
  const slashes = ['// fits', `// ${'word '.repeat(16)}word`].join('\n');
  assert.deepEqual(tooWide(slashes), ['2: 87 columns, over 80 for a wrapped comment']);

  // The same width on one line of its own is in bounds, until 100.
  assert.deepEqual(tooWide(`/** ${'word '.repeat(16)}word */`), []);
  assert.deepEqual(tooWide(`// ${'word '.repeat(20)}word`), [
    '1: 107 columns, over 100 for a one-line comment',
  ]);

  // Code is not a comment, a trailing comment included.
  assert.deepEqual(tooWide(`const x = 1; // ${'word '.repeat(30)}`), []);
});

test('a line whose overflow is a URL or a directive passes', () => {
  const link = 'https://example.com/a/very/long/path/that/goes/on/and/on/for/quite/a/while';
  assert.deepEqual(tooWide(['/**', ` * See the export format at ${link}.`, ' */'].join('\n')), []);
  // Words after the URL could have wrapped, so they still count.
  assert.equal(tooWide(['/**', ` * See ${link} and then more words`, ' */'].join('\n')).length, 1);

  const reason = 'word '.repeat(20);
  assert.deepEqual(tooWide(['// fits', `// @ts-expect-error ${reason}`].join('\n')), []);
  assert.deepEqual(tooWide(['// fits', `// oxlint-disable-next-line no-console ${reason}`].join('\n')), []);
});

test('a JSDoc type passes, but prose after it still counts', () => {
  const type = `{{ ${'field: number, '.repeat(5)}last: string }}`;
  assert.deepEqual(tooWide(['/**', ` * @param ${type} [options]`, ' */'].join('\n')), []);
  assert.deepEqual(tooWide(['/**', ` * @typedef ${type} Options`, ' */'].join('\n')), []);
  assert.deepEqual(tooWide(`/** @type ${type} */`), []);
  assert.equal(tooWide(['/**', ` * @property ${type} options What to fetch.`, ' */'].join('\n')).length, 1);
  // A type that fits leaves no excuse for the prose after it.
  assert.equal(tooWide(['/**', ` * @param {string} id ${'word '.repeat(14)}`, ' */'].join('\n')).length, 1);
});

test("no comment in the repo's source or tests is too wide", () => {
  const files = sourceFiles();
  assert.ok(files.some((file) => file.startsWith('src/')), 'git ls-files listed no source');

  const offenders = files.flatMap((file) =>
    tooWide(readFileSync(path.join(REPO, file), 'utf8')).map((complaint) => `${file}:${complaint}`),
  );
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`);
});
