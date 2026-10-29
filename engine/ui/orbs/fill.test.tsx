import { describe, expect, test } from 'vitest';
import { cascade, orbFills, walletName } from './fill.ts';

const CAP = 600;
const solids = (settled: number, pending = 0) => orbFills(settled, pending, CAP).orbs.map((o) => o.solid);

describe('hundredths to six fills', () => {
  test('0 is six empty orbs', () => {
    expect(solids(0)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  test('2.40 is two full and the third at 40%', () => {
    expect(solids(240)).toEqual([1, 1, 0.4, 0, 0, 0]);
  });
  test('6.00 is six full', () => {
    expect(solids(600)).toEqual([1, 1, 1, 1, 1, 1]);
  });
  test('6.40 settled-plus-pending fills every orb in the ghost and says 0.40 past the cap', () => {
    const f = orbFills(500, 140, CAP);
    expect(f.orbs.map((o) => o.solid)).toEqual([1, 1, 1, 1, 1, 0]);
    expect(f.orbs[5]).toMatchObject({ gainFrom: 0, gainTo: 1 });
    expect(f.overflow).toBe(40);
  });
  test('a gain is hatched from the solid fill on, across orbs', () => {
    const f = orbFills(240, 85, CAP);
    expect(f.orbs[2]).toMatchObject({ solid: 0.4, gainFrom: 0.4, gainTo: 1 });
    expect(f.orbs[3]).toMatchObject({ solid: 0, gainFrom: 0, gainTo: 0.25 });
    expect(f.orbs[4]).toMatchObject({ gainFrom: 0, gainTo: 0 });
    expect(f.overflow).toBe(0);
  });
  test('a loss is a pale band over the solid fill it would take, never past empty', () => {
    const f = orbFills(240, -30, CAP);
    expect(f.orbs.map((o) => o.solid)).toEqual([1, 1, 0.4, 0, 0, 0]);
    expect(f.orbs[1]).toMatchObject({ lossFrom: 0, lossTo: 0 });
    expect(f.orbs[2]).toMatchObject({ lossFrom: 0.1, lossTo: 0.4 });
    expect(f.orbs[0]).toMatchObject({ lossFrom: 0, lossTo: 0 });
    const all = orbFills(50, -200, CAP);
    expect(all.orbs[0]).toMatchObject({ solid: 0.5, lossFrom: 0, lossTo: 0.5 });
  });
  test('the orb count follows the cap', () => {
    expect(orbFills(0, 0, 800).orbs).toHaveLength(8);
  });
});

describe('the accessible name', () => {
  test('a gain says it is pending and an estimate', () => {
    expect(walletName(240, 85, CAP)).toBe('Wallet 2.40 of 6 orbs, 0.85 pending until the next settlement (estimate)');
  });
  test('a loss says what would be lost', () => {
    expect(walletName(240, -30, CAP)).toBe('Wallet 2.40 of 6 orbs, 0.30 to be lost at the next settlement (estimate)');
  });
  test('nothing pending says the wallet alone', () => {
    expect(walletName(240, 0, CAP)).toBe('Wallet 2.40 of 6 orbs');
  });
  test('past the cap it says so', () => {
    expect(walletName(500, 140, CAP)).toBe('Wallet 5.00 of 6 orbs, 1.40 pending until the next settlement (estimate), 0.40 past the cap');
  });
});

describe('the cascade at a settlement', () => {
  test('one orb a second, in order, from the first that changes, each that fills marked to flash', () => {
    expect(cascade(140, 360, CAP)).toEqual([
      { orb: 1, at: 0, fills: true },
      { orb: 2, at: 1000, fills: true },
      { orb: 3, at: 2000, fills: false },
    ]);
  });
  test('no change is no cascade', () => {
    expect(cascade(240, 240, CAP)).toEqual([]);
  });
  test('a spend runs it backwards, from the last orb that changes', () => {
    expect(cascade(360, 140, CAP)).toEqual([
      { orb: 3, at: 0, fills: false },
      { orb: 2, at: 1000, fills: false },
      { orb: 1, at: 2000, fills: false },
    ]);
  });
});
