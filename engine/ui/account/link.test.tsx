import { describe, expect, test } from 'vitest';
import { tokenHashOf } from './link.ts';

const HASH = 'abcdefghij0123456_-XYZ';

describe('tokenHashOf', () => {
  test('reads the token hash from a fragment, with or without its leading #', () => {
    expect(tokenHashOf(`token_hash=${HASH}`)).toBe(HASH);
    expect(tokenHashOf(`#token_hash=${HASH}`)).toBe(HASH);
    expect(tokenHashOf(`type=email&token_hash=${HASH}`)).toBe(HASH);
  });

  test('is null for a fragment that is not a token hash', () => {
    expect(tokenHashOf('')).toBeNull();
    expect(tokenHashOf('top')).toBeNull();
    expect(tokenHashOf('#top')).toBeNull();
    expect(tokenHashOf('token_hash=')).toBeNull();
    expect(tokenHashOf('#token_hash=')).toBeNull();
    expect(tokenHashOf('other=1')).toBeNull();
  });

  test('is null for a value of the wrong shape: too short, too long, or with other characters', () => {
    expect(tokenHashOf('token_hash=abc')).toBeNull();
    expect(tokenHashOf(`token_hash=${'a'.repeat(15)}`)).toBeNull();
    expect(tokenHashOf(`token_hash=${'a'.repeat(16)}`)).toBe('a'.repeat(16));
    expect(tokenHashOf(`token_hash=${'a'.repeat(256)}`)).toBe('a'.repeat(256));
    expect(tokenHashOf(`token_hash=${'a'.repeat(257)}`)).toBeNull();
    expect(tokenHashOf('token_hash=abcdefghij0123456<script>')).toBeNull();
    expect(tokenHashOf('token_hash=abcdefghij 0123456789')).toBeNull();
  });

  test('trims the value before it is checked', () => {
    expect(tokenHashOf(`token_hash=%20${HASH}%20`)).toBe(HASH);
  });
});
