/**
 * `schemaProblems` holds a schema to what a provider's structured output accepts. Each test is a poison: a
 * schema with exactly one defect the provider refused (or the published rules forbid), which must come back with
 * its predicate and path. The clean cases sit at the limits, so a check tightened by one fails here too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANTHROPIC_SCHEMA_RULES, schemaProblems } from './schema.ts';

const str = { type: 'string' };
const obj = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
/** `n` string properties named `${prefix}0..`, none required unless `required` says so. */
const props = (prefix: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, str]));

test('an empty schema nested in a property is named at its path', () => {
  const s = obj({ moves: { type: 'array', items: obj({ params: {} }) } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.moves.items.properties.params', predicate: 'emptySchema' }]);
});

test('an array with no items holds any value, named at its items', () => {
  const s = obj({ notes: { type: 'array' } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.notes.items', predicate: 'emptySchema' }]);
});

test('a problem inside an anyOf branch is named at that branch', () => {
  const s = obj({ pick: { anyOf: [str, { type: 'string', maxLength: 4 }] } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.pick.anyOf.1', predicate: 'keyword(maxLength)' }]);
});

test('maxItems is a keyword the provider refuses', () => {
  const s = obj({ findings: { type: 'array', items: str, maxItems: 3 } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.findings', predicate: 'keyword(maxItems)' }]);
});

test('minLength is a keyword the provider refuses', () => {
  const s = obj({ ruling: { type: 'string', minLength: 1 } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.ruling', predicate: 'keyword(minLength)' }]);
});

test('pattern is a keyword the provider refuses', () => {
  const s = obj({ tag: { type: 'string', pattern: '^[a-z]+$' } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.tag', predicate: 'keyword(pattern)' }]);
});

test('minItems above 1 names the offending value', () => {
  const s = obj({ picks: { type: 'array', items: str, minItems: 2 } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.picks', predicate: 'minItems(2)' }]);
});

test('an object without additionalProperties false is not closed', () => {
  const s = obj({ inner: { type: 'object', properties: { a: str }, required: ['a'] } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.inner', predicate: 'closedObject' }]);
});

test('a type outside the list names the type', () => {
  const s = obj({ gone: { type: 'null' } });
  assert.deepEqual(schemaProblems(s), [{ path: 'properties.gone', predicate: 'type(null)' }]);
});

test('nine optional properties in one object name the limit, at that object', () => {
  const s = obj(props('p', 9), []);
  assert.deepEqual(schemaProblems(s), [{ path: '', predicate: 'optionalPerObject(8)' }]);
});

test('25 optional properties over three objects name the total, at the root', () => {
  const s = obj({ a: obj(props('p', 8), []), b: obj(props('q', 8), []), c: obj(props('r', 8), []), d: obj({ x: str }, []) }, ['a', 'b', 'c', 'd']);
  // 8 + 8 + 8 + 1 = 25 optional, no object over 8, and 29 properties in all: only the total fails.
  assert.deepEqual(schemaProblems(s), [{ path: '', predicate: 'optionalTotal(24)' }]);
});

test('17 anyOf name the limit, at the root', () => {
  const s = obj(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`u${i}`, { anyOf: [str, { type: 'number' }] }])));
  assert.deepEqual(schemaProblems(s), [{ path: '', predicate: 'unionsTotal(16)' }]);
});

test('41 properties name the limit, at the root', () => {
  const s = obj(props('p', 41));
  assert.deepEqual(schemaProblems(s), [{ path: '', predicate: 'propertiesTotal(40)' }]);
});

test('the apology schema shape is clean', () => {
  const s = obj({ verdict: { type: 'string', enum: ['forgiven', 'refused'] }, ruling: str });
  assert.deepEqual(schemaProblems(s), []);
});

test('a schema at every limit at once is clean', () => {
  // 40 properties: 8 optional in one object, 16 unions, the rest required.
  const unions = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`u${i}`, { anyOf: [str, { type: 'number' }] }]));
  const s = obj({ opt: obj(props('o', 8), []), ...unions, ...props('r', 40 - 1 - 8 - 16) });
  assert.equal(JSON.stringify(s).match(/"anyOf"/g)?.length, 16);
  assert.deepEqual(schemaProblems(s), []);
});

test('the table names its provider, date and source', () => {
  assert.equal(ANTHROPIC_SCHEMA_RULES.provider, 'anthropic');
  assert.equal(ANTHROPIC_SCHEMA_RULES.verified, '2026-11-11');
});
