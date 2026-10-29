import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKeys, sameName } from './names.ts';
import { NAME_FOLDS } from './name-folds.data.ts';

test('a Cyrillic letter that looks Latin is the same name as the Latin one', () => {
  // U+0435 CYRILLIC SMALL LETTER IE for the e; U+0420 and U+0456 for the P and the i.
  assert.ok(sameName('Pipewrеnch', 'Pipewrench'));
  assert.ok(sameName('Ріpewrench', 'Pipewrench'));
});

test('a name differing only in case is the same name', () => {
  assert.ok(sameName('PIPEWRENCH', 'pipewrench'));
  assert.ok(sameName('PipeWrench', 'Pipewrench'));
});

test('a digit or a letter that looks like another is that one: a capital I is an l as written, whatever case folding makes of it', () => {
  assert.ok(sameName('B0b', 'Bob'));
  assert.ok(sameName('Pipewrench1', 'PipewrenchI'));
  assert.ok(sameName('PipewrenchI', 'Pipewrenchl'));
  // Two keys, since folding case first makes the capital I an i: as written, I, l and 1 are one.
  assert.notEqual(nameKeys('PipewrenchI').folded, nameKeys('Pipewrenchl').folded);
  assert.equal(nameKeys('PipewrenchI').look, nameKeys('Pipewrenchl').look);
});

test('a name that says something more is a different name', () => {
  for (const other of ['Pipewrench II', 'The Real Pipewrench', 'Pipewrenches', 'Pipe Wrench']) assert.ok(!sameName(other, 'Pipewrench'), other);
});

test('a name in a composed or decomposed form is the same name', () => {
  assert.ok(sameName('Café', 'Café'));
});

test('the data says which Unicode release it is, which the database\'s copy names too', () => {
  assert.match(NAME_FOLDS.unicode, /^\d+\.\d+\.\d+$/);
  assert.ok(Object.keys(NAME_FOLDS.confusable).length > 6000);
  assert.ok(Object.keys(NAME_FOLDS.fold).length > 1500);
});
