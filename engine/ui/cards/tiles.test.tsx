/**
 * tiles.ts, the layer's arithmetic (docs/plans/2026-11-16-effect-tiles-design.md, section 3): the tile's height, the density a tile is
 * drawn at so that no canvas passes 2,457,600 px at any width, and which tiles of a box are held for a view.
 */
import { describe, expect, test } from 'vitest';
import { bandsOf } from './bands.ts';
import {
  MAX_TILE_DENSITY, MAX_TILE_PIXELS, MAX_TILE_WIDTH_PX, TILE_NEAR_PX, TILE_PX, mostTiles, nearTiles, tileDensity,
} from './tiles.ts';

describe('the constants', () => {
  test('are the design\'s figures', () => {
    expect(TILE_PX).toBe(512);
    expect(TILE_NEAR_PX).toBe(256);
    expect(MAX_TILE_DENSITY).toBe(2);
    expect(MAX_TILE_WIDTH_PX).toBe(1200);
    expect(MAX_TILE_PIXELS).toBe(2_457_600);
  });
});

describe('tileDensity', () => {
  test('is the least of the cap, the screen and the ask', () => {
    expect(tileDensity(600, 3)).toBe(2);
    expect(tileDensity(600, 1.5)).toBe(1.5);
    expect(tileDensity(600, 2, 1)).toBe(1);
    expect(tileDensity(600, 1, 2)).toBe(1);
    expect(tileDensity(600, 3, 5)).toBe(2);
    expect(tileDensity(600, 2, undefined)).toBe(2);
  });

  test('keeps a canvas of at most 2,400 px across by lowering the density of a box wider than 1,200', () => {
    expect(tileDensity(1200, 2)).toBe(2);
    for (const w of [1201, 1500, 2000, 3000]) {
      const d = tileDensity(w, 2);
      expect(d).toBeLessThan(2);
      expect(Math.ceil(w * d)).toBeLessThanOrEqual(2400);
    }
  });

  test('never makes a tile of more than MAX_TILE_PIXELS, for every width and screen', () => {
    for (let w = 1; w <= 3000; w += 7) {
      for (const screen of [1, 1.5, 2, 2.625, 3]) {
        for (const ask of [undefined, 1, 1.5, 2, 3]) {
          const d = tileDensity(w, screen, ask);
          expect(Math.ceil(w * d) * Math.ceil(TILE_PX * d)).toBeLessThanOrEqual(MAX_TILE_PIXELS);
        }
      }
    }
  });

  test('is 1 for a density that is not a positive finite number', () => {
    for (const bad of [0, -2, NaN, Infinity, -Infinity]) {
      expect(tileDensity(600, bad)).toBe(1);
      expect(tileDensity(600, 2, bad)).toBe(1);
    }
  });
});

describe('mostTiles', () => {
  test('is ceil((viewport + 2 * near) / tile) + 1', () => {
    expect(mostTiles(900)).toBe(4);
    expect(mostTiles(844)).toBe(4);
    expect(mostTiles(500)).toBe(3);
  });
});

describe('nearTiles', () => {
  test('names the tiles within TILE_NEAR_PX of the view', () => {
    const tiles = bandsOf(2000, TILE_PX);
    expect(tiles.length).toBe(4);
    expect(nearTiles(2000, 0, 900)).toEqual([0, 1, 2]);
    expect(nearTiles(2000, 1000, 1900)).toEqual([1, 2, 3]);
    expect(nearTiles(2000, 0, 100)).toEqual([0]);
  });

  test('a view inside a tall box holds at most mostTiles(900) tiles, at every step', () => {
    for (let top = -1000; top <= 41_000; top += 100) {
      expect(nearTiles(40_000, top, top + 900).length).toBeLessThanOrEqual(mostTiles(900));
    }
  });

  test('holds none for a view wholly above or below the box by more than TILE_NEAR_PX', () => {
    expect(nearTiles(2000, -1500, -300)).toEqual([]);
    expect(nearTiles(2000, 2300, 3200)).toEqual([]);
    expect(nearTiles(2000, -1500, -TILE_NEAR_PX - 1)).toEqual([]);
    expect(nearTiles(2000, 2000 + TILE_NEAR_PX + 1, 4000)).toEqual([]);
  });

  test('holds the edge tile for a view just within TILE_NEAR_PX of the box', () => {
    expect(nearTiles(2000, -1500, -TILE_NEAR_PX + 1)).toEqual([0]);
    expect(nearTiles(2000, 2000 + TILE_NEAR_PX - 1, 4000)).toEqual([3]);
  });

  test('holds none for a box of no height', () => {
    expect(nearTiles(0, 0, 900)).toEqual([]);
    expect(nearTiles(-5, 0, 900)).toEqual([]);
  });
});
