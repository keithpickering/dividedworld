/**
 * The list rows' stylesheets (docs/plans/2026-11-12-list-rows-design.md, sections 2.1 to 2.3): every cell of a board row and a thread row
 * stands on the title's baseline, "spun from" has a line of its own at every width, and a folded row keeps its counts on one line and puts
 * the last post on the next. The two stylesheets are read as text; the rendered measures are e2e/list-rows.spec.ts's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const board = strip(fs.readFileSync(path.resolve(here, 'board.css'), 'utf8'));
const index = strip(fs.readFileSync(path.resolve(here, '../index/index.css'), 'utf8'));

/* The text inside the braces of the first at-rule whose head starts with `head`, found by matching braces. */
const block = (css: string, head: string): string => {
  const at = css.indexOf(head);
  if (at < 0) throw new Error(`no ${head} block`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`${head} block never closes`);
};
/* The css with every @media and @container block cut out: what applies at every width. */
const outside = (css: string): string => {
  let out = css;
  for (;;) {
    const m = /@(?:media|container)[^{]*\{/u.exec(out);
    if (!m) return out;
    const inner = block(out, m[0]);
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length + inner.length + 1);
  }
};
/* The declaration blocks of every rule whose comma-separated selector list includes `selector` exactly, trimmed. */
const rules = (text: string, selector: string): string[] => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter((m) => m[1]!.split(',').map((s) => s.replace(/\s+/gu, ' ').trim()).includes(selector))
  .map((m) => m[2]!.trim());

const fold = block(board, '@container');
const phone = block(index, '@media (max-width: 40em)');

describe('the rows stand on the title\'s baseline (2.3)', () => {
  test('outside any query a board row\'s cells and a thread row\'s cells are baseline-aligned, and the folder cell is still centered', () => {
    expect(rules(outside(index), '.kb-table.kb-board-list .kb-board-row > td').join(';')).toMatch(/vertical-align:\s*baseline/u);
    expect(rules(outside(board), '.kb-table.kb-thread-list .kb-thread-row > td').join(';')).toMatch(/vertical-align:\s*baseline/u);
    const flags = [...outside(board).matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .filter((m) => /kb-thread-flags/u.test(m[1]!) && /vertical-align/u.test(m[2]!));
    expect(flags.length).toBeGreaterThan(0);
    for (const m of flags) expect(m[2]).toMatch(/vertical-align:\s*middle/u);
  });
});

describe('"spun from" has a line of its own (2.2)', () => {
  test('.kb-thread-spun is a block at every width', () => {
    expect(rules(outside(board), '.kb-thread-spun').join(';')).toMatch(/display:\s*block/u);
  });
});

describe('a folded thread row: counts on a line, the last post on the next (2.1)', () => {
  test('in the container block the last post is a block and the counts stay inline', () => {
    expect(rules(fold, '.kb-table.kb-thread-list .kb-thread-row > td.kb-thread-last').join(';')).toMatch(/display:\s*block/u);
    for (const cell of ['replies', 'views']) {
      expect(rules(fold, `.kb-table.kb-thread-list .kb-thread-row > td.kb-thread-${cell}`).join(';'), cell).toMatch(/display:\s*inline/u);
    }
  });
});

describe('a folded board row: threads on a line, the last post on the next (2.1)', () => {
  test('in the phone block the threads and the last post are blocks, and the by-unit is one inline-block no wider than the row', () => {
    expect(rules(phone, '.kb-table.kb-board-list .kb-board-row > td.kb-board-threads').join(';')).toMatch(/display:\s*block/u);
    expect(rules(phone, '.kb-table.kb-board-list .kb-board-row > td.kb-board-last').join(';')).toMatch(/display:\s*block/u);
    const by = rules(phone, '.kb-board-last-by').join(';');
    expect(by).toMatch(/display:\s*inline-block/u);
    expect(by).toMatch(/max-width:\s*100%/u);
  });

  test('the "last:" label is hidden on a desktop, where the column head names the cell, and shown on a phone', () => {
    expect(rules(outside(index), '.kb-board-last-label').join(';')).toMatch(/display:\s*none/u);
    expect(rules(phone, '.kb-board-last-label').join(';')).toMatch(/display:\s*inline/u);
    expect(rules(outside(index), '.kb-board-sep').join(';')).toMatch(/display:\s*none/u);
  });

  test('no rule names the last cell\'s direct link: the time\'s link is a child of the by-unit', () => {
    expect(index).not.toMatch(/\.kb-board-last\s*>\s*a/u);
  });
});
