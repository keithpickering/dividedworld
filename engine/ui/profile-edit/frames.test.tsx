import { describe, expect, test } from 'vitest';
import {
  composeFrames, cutRect, defaultPortrait, defaultSquare, framePixels, moveFrame, outputSize, portraitProblem, scaleFrame, stretchFrame, tallness,
} from './frames.ts';

const picture = { width: 800, height: 1000 };

describe('portrait frames', () => {
  test('are measured in the picture\'s pixels: a frame is a fraction of each side', () => {
    const f = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
    expect(framePixels(f, picture)).toEqual({ width: 400, height: 400 });
    expect(tallness(f, picture)).toBe(1);
    expect(tallness({ x: 0, y: 0, w: 0.5, h: 0.8 }, picture)).toBe(2);
  });

  test('refuse a frame taller than 2:1, in plain words, and one wider than tall', () => {
    const tall = { x: 0, y: 0, w: 0.25, h: 0.6 };
    expect(tallness(tall, picture)).toBeCloseTo(3);
    expect(portraitProblem(tall, picture)).toBe('A portrait can be at most twice as tall as it is wide. Make the frame wider or shorter.');
    const wide = { x: 0, y: 0, w: 0.9, h: 0.4 };
    expect(portraitProblem(wide, picture)).toBe('A portrait is at least as tall as it is wide. Make the frame taller or narrower.');
  });

  test('accept 1:1 and exactly 2:1 (rounding aside), and anything between', () => {
    expect(portraitProblem({ x: 0, y: 0, w: 0.5, h: 0.4 }, picture)).toBeNull();
    expect(portraitProblem({ x: 0, y: 0, w: 0.4, h: 0.64 }, picture)).toBeNull();
    expect(portraitProblem({ x: 0.1, y: 0, w: 0.4, h: 0.64 + 1e-12 }, picture)).toBeNull();
  });

  test('refuse a frame that leaves the picture or is a speck', () => {
    expect(portraitProblem({ x: 0.7, y: 0, w: 0.5, h: 0.5 }, picture)).toBe('The frame has to stay inside the picture.');
    expect(portraitProblem({ x: 0, y: 0, w: 0.01, h: 0.01 }, picture)).toBe('The frame is too small to cut a portrait from.');
  });

  test('default to the whole picture when its shape allows, and to the top 2:1 of a taller one', () => {
    expect(defaultPortrait({ width: 800, height: 1000 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(defaultPortrait({ width: 500, height: 2000 })).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    const wide = defaultPortrait({ width: 2000, height: 1000 });
    expect(wide).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    for (const p of [{ width: 800, height: 1000 }, { width: 500, height: 2000 }, { width: 2000, height: 1000 }]) {
      expect(portraitProblem(defaultPortrait(p), p)).toBeNull();
    }
  });
});

describe('the square frame', () => {
  test('defaults to the top of the portrait, full width, and is square in pixels', () => {
    const portrait = { width: 400, height: 800 };
    const sq = defaultSquare(portrait);
    expect(sq).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(framePixels(sq, portrait)).toEqual({ width: 400, height: 400 });
  });

  test('is cut from inside the portrait: the two frames compose into the picture\'s coordinates', () => {
    const pf = { x: 0.1, y: 0.2, w: 0.5, h: 0.8 };
    const sq = { x: 0.2, y: 0.5, w: 0.5, h: 0.25 };
    const c = composeFrames(pf, sq);
    expect(c.x).toBeCloseTo(0.2);
    expect(c.y).toBeCloseTo(0.6);
    expect(c.w).toBeCloseTo(0.25);
    expect(c.h).toBeCloseTo(0.2);
  });
});

describe('moving and resizing', () => {
  test('a move stays inside the picture', () => {
    expect(moveFrame({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 0.3, 0.3)).toEqual({ x: 0.4, y: 0.4, w: 0.5, h: 0.5 });
    expect(moveFrame({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 0.9, 0.9)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(moveFrame({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, -1, -1)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  });

  test('a scale keeps the shape and the center, and is held inside the picture and above the least size', () => {
    const f = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const bigger = scaleFrame(f, 1.2);
    expect(bigger.w).toBeCloseTo(0.6);
    expect(bigger.h).toBeCloseTo(0.6);
    expect(bigger.x + bigger.w / 2).toBeCloseTo(0.5);
    const edge = scaleFrame({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 1.5);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1 + 1e-12);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1 + 1e-12);
    expect(edge.w / edge.h).toBeCloseTo(1);
    const tiny = scaleFrame(f, 0.01);
    expect(tiny.w).toBeGreaterThanOrEqual(0.05 - 1e-12);
    const huge = scaleFrame({ x: 0, y: 0, w: 0.5, h: 1 }, 5);
    expect(huge.h).toBeLessThanOrEqual(1);
    expect(huge.w / huge.h).toBeCloseTo(0.5);
  });

  test('a stretch changes one side, keeps the corner, and is held inside the picture', () => {
    const f = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    expect(stretchFrame(f, 0, 0.1)).toMatchObject({ x: 0.2, y: 0.2, w: 0.3 });
    expect(stretchFrame(f, 0, 0.1).h).toBeCloseTo(0.4);
    expect(stretchFrame(f, 5, 5)).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
    expect(stretchFrame(f, -5, -5).w).toBeCloseTo(0.05);
  });
});

describe('what is cut and what is sent', () => {
  test('a pixel rectangle is the frame in the picture\'s pixels', () => {
    expect(cutRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, picture)).toEqual({ x: 80, y: 200, width: 400, height: 400 });
  });

  test('the portrait is scaled to 256 to 512 wide keeping its shape, and never past 2:1', () => {
    expect(outputSize({ width: 400, height: 800 })).toEqual({ width: 400, height: 800 });
    expect(outputSize({ width: 1200, height: 1800 })).toEqual({ width: 512, height: 768 });
    expect(outputSize({ width: 100, height: 150 })).toEqual({ width: 256, height: 384 });
    expect(outputSize({ width: 300, height: 600.4 })).toEqual({ width: 300, height: 600 });
    expect(outputSize({ width: 300, height: 601 }).height).toBeLessThanOrEqual(600);
  });
});
