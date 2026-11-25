/**
 * The credits /license lists (docs/plans/2026-11-25-licensing-plan.md, Task 5) are held to the manifests they are built from: every
 * `licenses.json` row that qualifies appears, the sounds are one credit, the card, back and pack art that share terms are one credit, and
 * Hot Debate's fire and each Jimmy Wails plate are credited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { credits } from './credits.ts';
import { PLATES } from './jimmy-wails/plates.ts';
import { instanceUi } from './index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(fs.readFileSync(path.join(here, '..', 'licenses.json'), 'utf8')) as { files: string[]; maker: string; terms: unknown; work?: string; note?: string }[];
const qualifies = (r: (typeof rows)[number]) => r.terms !== 'layer' || r.maker !== 'Divided World' || r.note !== undefined;

describe('Divided World\'s credits', () => {
  test('are what the instance hands /license', () => {
    expect(instanceUi.licensing.credits).toBe(credits);
  });

  test('hold every licenses.json row whose terms are its own, whose maker is not Divided World, or that carries a note', () => {
    const works = new Set(credits.map((c) => `${c.work}|${c.maker}`));
    const qualifying = rows.filter(qualifies);
    expect(qualifying.length).toBeGreaterThan(0);
    for (const r of qualifying) expect(works, `${r.work} (${r.files[0]})`).toContain(`${r.work ?? r.files[0]}|${r.maker}`);
  });

  test('a row\'s own terms are named and linked, and "layer" terms are the instance\'s own', () => {
    const anton = credits.find((c) => c.work === 'Anton');
    expect(anton?.note).toContain('Copyright 2020 The Anton Project Authors');
    expect(anton).toMatchObject({ maker: 'The Anton Project Authors', terms: 'SIL Open Font License 1.1', termsUrl: 'https://openfontlicense.org', source: 'https://github.com/googlefonts/AntonFont' });
    const wiggler = credits.find((c) => c.work === 'Wiggler sprite sheet');
    expect(wiggler?.terms).toBe('Divided World\'s terms (AGPL-3.0-or-later or CC BY 4.0)');
    expect(wiggler?.note).toContain('Nintendo');
  });

  test('name no work twice', () => {
    const keys = credits.map((c) => `${c.work}|${c.maker}|${c.source ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('the sounds are one credit, and every sounds.json row shares one source', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(here, 'sounds', 'sounds.json'), 'utf8')) as { source: string }[];
    expect(new Set(manifest.map((r) => r.source)).size).toBe(1);
    const sounds = credits.filter((c) => c.work === 'Sound effects');
    expect(sounds).toEqual([{ work: 'Sound effects', maker: `Divided World, with ${manifest[0]?.source}`, terms: 'ElevenLabs\' terms; not offered for reuse', termsUrl: 'https://elevenlabs.io/service-specific-terms' }]);
  });

  test('the card, back and pack art under shared terms are one credit', () => {
    const art = credits.filter((c) => c.work.startsWith('Card art'));
    expect(art).toHaveLength(1);
    expect(art[0]).toMatchObject({ work: 'Card art: every card\'s picture and mark, the card back, the pack art', maker: 'Divided World', terms: 'CC0 1.0 Universal', termsUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' });
  });

  test('Hot Debate\'s fire and each Jimmy Wails plate are credited', () => {
    expect(credits.find((c) => c.work === 'Animated fire')).toMatchObject({ maker: 'Nevit Dilmen', terms: 'CC BY-SA 3.0', termsUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' });
    for (const p of PLATES) expect(credits.some((c) => c.source === p.credit.source && c.maker === p.credit.author && c.work === 'Photograph of Jimmy Wales (Wikimedia Commons)' && c.note === 'Cropped and faded for the Jimmy Wails banner.'), p.key).toBe(true);
  });
});
