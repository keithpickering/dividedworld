/**
 * Tests for Divided World's sound levels (docs/plans/2026-11-12-laugh-track-band-plan.md, Task 2): the gain worked out
 * from the manifest, and the manifest and the slots naming the same files.
 *
 * `sounds.ts` imports each file as `?url`, which Vite resolves and Node does not; a loader hook registered here
 * answers those imports with the file's name, as Vite would answer with its URL.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import manifest from './sounds/sounds.json' with { type: 'json' };

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.mp3?url')) return { url: 'data:text/javascript,' + encodeURIComponent('export default ' + JSON.stringify(specifier.slice(0, -4))), shortCircuit: true };
  return next(specifier, context);
}`),
  import.meta.url,
);
const { gainOf, sounds } = await import('./sounds.ts');

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('gainOf: up or down to -18 LUFS', () => {
  assert.ok(near(gainOf({ lufs: -38, peak: -24 }), 10));
  assert.ok(near(gainOf({ lufs: -12, peak: -1 }), 10 ** (-6 / 20)));
});

test('gainOf: never so far up that the peak passes -1 dBFS', () => {
  const g = gainOf({ lufs: -30, peak: -4 });
  assert.ok(near(g, 10 ** (3 / 20)), String(g));
  assert.ok(g > 1.41 && g < 1.42);
});

test('every slot has a finite gain above 0, and every file in the manifest is a slot\'s', () => {
  for (const s of sounds.slots) assert.ok(Number.isFinite(s.gain) && (s.gain as number) > 0, `${s.key} has no usable gain`);
  const slotFiles = sounds.slots.map((s) => s.src.replace(/^.*\//, '')).sort();
  assert.deepEqual(slotFiles, manifest.map((e) => e.file).sort());
});

test('every slot\'s gain is the gain of its own file\'s manifest entry', () => {
  for (const s of sounds.slots) {
    const file = s.src.replace(/^.*\//, '');
    const entry = manifest.find((e) => e.file === file);
    assert.ok(entry, `${s.key} names ${file}, which the manifest lacks`);
    assert.ok(near(s.gain as number, gainOf(entry)), `${s.key} has gain ${s.gain}, not the gain of ${file}`);
  }
});

test('laugh-3 is loud and near full scale: brought down for loudness, and its peak ends under -1 dBFS', () => {
  const entry = manifest.find((e) => e.file === 'laugh-3.mp3');
  assert.ok(entry);
  assert.deepEqual([entry.lufs, entry.peak], [-11.7, -0.9]);
  const slot = sounds.slots.find((s) => s.key === 'laugh-track.laugh-3');
  assert.ok(slot && near(slot.gain as number, 10 ** (-6.3 / 20)), String(slot?.gain));
  assert.ok(20 * Math.log10(slot.gain as number) + entry.peak <= -1);
});
