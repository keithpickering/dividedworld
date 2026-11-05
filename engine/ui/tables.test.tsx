/**
 * The Season, Rankings and Log tables stand on the page's own left edge, as its text does, and on the phone the column heads
 * they hide for the eye do not lay a table wider than the column (the layout check names each such row: e2e/glass-layout.ts, refusal 2).
 */
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (text: string, selector: string): string[] => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(',').map((s) => s.replace(/\s+/g, ' ').trim()).includes(selector)).map((m) => m[2]!);
const PHONE = ":where(:root[data-kb-layout='phone'])";

describe('the rankings table', () => {
  const text = css('engine/ui/rankings/rankings.css');
  test('its first column starts at the left edge of the page\'s text, an own row\'s band drawn outside it', () => {
    for (const sel of ['.kb-rankings-table th.kb-rankings-place', '.kb-rankings-table td.kb-rankings-place']) {
      expect(rules(text, sel).join(';')).not.toMatch(/padding-left:\s*[1-9]/);
    }
    expect(rules(text, '.kb-rankings-table tr[data-kb-own] td:first-child').join(';')).not.toMatch(/padding-left/);
    expect(rules(text, '.kb-rankings-table tr[data-kb-own] td:first-child::before').join(';')).toMatch(/left:\s*-\d+px/);
    expect(rules(text, `${PHONE} .kb-rankings-table tbody tr`).join(';')).toMatch(/padding:\s*10px 0;/);
  });
  test('the phone\'s hidden head row is no table row', () => {
    expect(rules(text, `${PHONE} .kb-rankings-table thead tr`).join(';')).toMatch(/display:\s*block/);
    expect(rules(text, `${PHONE} .kb-rankings-table thead th`).join(';')).toMatch(/display:\s*block/);
  });
});

describe('the log table', () => {
  const text = css('engine/ui/log/log.css');
  test('the phone\'s hidden head row is no table row', () => {
    expect(rules(text, `${PHONE} .kb-log-table thead tr`).join(';')).toMatch(/display:\s*block/);
    expect(rules(text, `${PHONE} .kb-log-table thead th`).join(';')).toMatch(/display:\s*block/);
  });
});
