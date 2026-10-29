/**
 * The cropper's frame math, pure: where a frame may sit and how big it may be, and what is cut.
 *
 * A frame is four fractions of the picture it is cut from (the API's `Frame`). The portrait's is in
 * the player's own picture; the square's is in the portrait, which is how the server keeps them.
 * Pixel shapes follow from the picture's size, so the portrait's shape is a fact about the
 * picture's pixels and not about the fractions. The server holds the same limits (the avatar
 * function): a portrait from 256 to 512 wide and from 1 to 2 times as tall as it is wide, a square
 * of 256 by 256.
 */
import type { Frame } from '../data/api.ts';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The least a frame may be, in each direction, as a fraction of its picture. */
export const MIN_FRACTION = 0.05;
/** A portrait is at most this many times as tall as it is wide, and at least as tall as wide. */
export const MOST_TALL = 2;
export const PORTRAIT_WIDTH = { least: 256, most: 512 } as const;
export const SQUARE_SIDE = 256;

const EPSILON = 1e-9;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** The frame's size in pixels of the picture it is cut from. */
export const framePixels = (frame: Frame, within: Size): Size => ({ width: frame.w * within.width, height: frame.h * within.height });

/** How many times as tall as wide the frame is, in pixels. */
export function tallness(frame: Frame, within: Size): number {
  const p = framePixels(frame, within);
  return p.height / p.width;
}

/** Why a portrait cannot be cut at this frame, in words a player reads, or null when it can. */
export function portraitProblem(frame: Frame, picture: Size): string | null {
  const inside = frame.x >= -EPSILON && frame.y >= -EPSILON && frame.x + frame.w <= 1 + EPSILON && frame.y + frame.h <= 1 + EPSILON;
  if (!inside) return 'The frame has to stay inside the picture.';
  if (frame.w < MIN_FRACTION - EPSILON || frame.h < MIN_FRACTION - EPSILON) return 'The frame is too small to cut a portrait from.';
  const t = tallness(frame, picture);
  if (t > MOST_TALL + EPSILON) return 'A portrait can be at most twice as tall as it is wide. Make the frame wider or shorter.';
  if (t < 1 - EPSILON) return 'A portrait is at least as tall as it is wide. Make the frame taller or narrower.';
  return null;
}

/** The whole picture where its shape is allowed, the top 2:1 of one taller than that, the middle square of a wide one. */
export function defaultPortrait(picture: Size): Frame {
  const { width, height } = picture;
  if (height >= MOST_TALL * width) return { x: 0, y: 0, w: 1, h: (MOST_TALL * width) / height };
  if (height >= width) return { x: 0, y: 0, w: 1, h: 1 };
  const w = height / width;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/** The square of a portrait of this size, at its top, where a face usually is: full width, square in pixels. */
export function defaultSquare(portrait: Size): Frame {
  return { x: 0, y: 0, w: 1, h: Math.min(1, portrait.width / portrait.height) };
}

/** The frame moved by a fraction of the picture each way, kept inside it. */
export function moveFrame(frame: Frame, dx: number, dy: number): Frame {
  return { ...frame, x: clamp(frame.x + dx, 0, 1 - frame.w), y: clamp(frame.y + dy, 0, 1 - frame.h) };
}

/** The frame scaled about its center, its shape kept, held inside the picture and above the least size. */
export function scaleFrame(frame: Frame, factor: number): Frame {
  const least = MIN_FRACTION / Math.min(frame.w, frame.h);
  const most = Math.min(1 / frame.w, 1 / frame.h);
  const k = Math.min(most, Math.max(least, factor));
  const w = frame.w * k;
  const h = frame.h * k;
  return {
    x: clamp(frame.x + frame.w / 2 - w / 2, 0, 1 - w),
    y: clamp(frame.y + frame.h / 2 - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/** One side or both changed by a fraction, the top left corner kept, held inside the picture. The shape is the caller's to check. */
export function stretchFrame(frame: Frame, dw: number, dh: number): Frame {
  return {
    ...frame,
    w: clamp(frame.w + dw, MIN_FRACTION, 1 - frame.x),
    h: clamp(frame.h + dh, MIN_FRACTION, 1 - frame.y),
  };
}

/** The size a portrait is sent at: 256 to 512 wide, its shape kept, at most twice as tall as wide. */
export function outputSize(portrait: Size): Size {
  const width = clamp(Math.round(portrait.width), PORTRAIT_WIDTH.least, PORTRAIT_WIDTH.most);
  const height = clamp(Math.round((width * portrait.height) / portrait.width), width, MOST_TALL * width);
  return { width, height };
}

/** The frame as a rectangle of whole pixels in its picture. */
export function cutRect(frame: Frame, within: Size): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  return {
    x: Math.round(frame.x * within.width),
    y: Math.round(frame.y * within.height),
    width: Math.max(1, Math.round(frame.w * within.width)),
    height: Math.max(1, Math.round(frame.h * within.height)),
  };
}

/** A frame in the portrait (the square) as it lies in the picture the portrait was cut from. */
export function composeFrames(portrait: Frame, inside: Frame): Frame {
  return { x: portrait.x + inside.x * portrait.w, y: portrait.y + inside.y * portrait.h, w: inside.w * portrait.w, h: inside.h * portrait.h };
}
