import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { systemStrings } from './voice.ts';

const HERE = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'admin' || e.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/u.test(e.name) && !/\.test\.tsx?$/u.test(e.name) ? [path] : [];
  });
}

test('the scan finds a planted "The System" in a string, a template, JSX text and a JSX attribute (aria-label, title), and not in a comment', () => {
  const planted = [
    '// The System is said here',
    '/* The System too */',
    "export const a = 'Only The System posts here';",
    'export const b = `${x} and The\n   System announce it`;',
    'export const c = <p>The System speaks</p>;',
    "export const d = 'The Boss speaks';",
    "export const e = <button aria-label=\"The System's mark\" title='Ask The System'>x</button>;",
    "export const f = <p aria-label={'The System'} title={`The System`}>y</p>;",
    'export const g = <p data-x="Not it" aria-label="The Boss">z</p>;',
  ].join('\n');
  assert.deepEqual(systemStrings('planted.tsx', planted).map((f) => f.line), [3, 4, 6, 8, 8, 9, 9]);
});

test('no screen under engine/ui/ (admin/ and tests apart) says "The System" in a string a player reads', () => {
  const files = sources(HERE);
  assert.ok(files.length > 100, 'the scan reads the screens');
  const found = files.flatMap((f) => systemStrings(f, readFileSync(f, 'utf8')).map((s) => `${relative(HERE, f)}:${s.line} ${s.text}`));
  assert.deepEqual(found, []);
});
