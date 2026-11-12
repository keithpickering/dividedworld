import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIXTURE, generate, serialize } from './video-verdicts.ts';

/* supabase/tests/data/video-verdicts.json is what videoOf says of a few thousand addresses; 0164-conduct-leaks.sql holds bb_video_like to it. It must be what videoOf says now. */
test('the video verdict fixture is what videoOf says now (regenerate with node engine/bbcode/video-verdicts.ts)', () => {
  const v = generate();
  assert.equal(fs.readFileSync(FIXTURE, 'utf8'), serialize(v));
});

test('the verdict fixture holds both verdicts, from hosts of every kind', () => {
  const v = generate();
  const all = Object.entries(v);
  assert.ok(all.length >= 3000, `${all.length} addresses`);
  assert.ok(all.filter(([, x]) => x === 'video').length > 300);
  assert.ok(all.filter(([, x]) => x === 'words').length > 1000);
  for (const probe of ['https://example.123/a.mp4', 'https://1.2.3.256/a.mp4', 'https://xn--a.example/a.mp4', 'https://example.com/a.mp4', 'https://youtu.be/abcdefghijk']) assert.ok(probe in v, probe);
});
