/**
 * Token counters for the old voice's prompt window.
 *
 * `tokenCounter(kind)` returns a function from text to a token count, for the instance's
 * `oldVoiceTokenizer` setting:
 *
 *   gpt2   GPT-2's byte-level BPE, exact for GPT-2, GPT-Neo and GPT-J, which share it. Plain
 *          TypeScript over the published vocabulary and merges vendored in
 *          `tokenizers/gpt2/bpe.json` (see its README): the published pre-tokenizing pattern, the
 *          bytes-to-unicode table, then merges by rank. Only the count is kept, never the ids.
 *   bytes  One token per UTF-8 byte, which a byte-level BPE never exceeds, so it bounds any such
 *          model. A lone surrogate counts as the replacement character's three bytes, as the
 *          encoder would write it.
 *
 * Only edge code imports this module. The vocabulary is about 1.3 MB and must never reach the
 * browser's bundle, and the card rules (and so each card's frame) are imported by the screens. A
 * frame is therefore handed the counter as a function (`WriteFrameInput.count`) and never imports
 * it. The JSON is imported with `with { type: 'json' }` so it loads the same way in Node's tests
 * and in Deno.
 */

import type { Settings } from '../rules/types.ts';
import bpe from './tokenizers/gpt2/bpe.json' with { type: 'json' };

/** GPT-2's published pre-tokenizing pattern (encoder.py), with `\p{L}` and `\p{N}` for its classes. */
const PRETOKENIZE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

/** The most pieces kept in the cache; when full it is emptied, which a few thousand words refill. */
const CACHE_MOST = 20_000;

/** GPT-2's bytes-to-unicode table: each byte as a printable character, the rest shifted past 255. */
const BYTE_CHAR: readonly string[] = (() => {
  const keep: number[] = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  const table: string[] = new Array<string>(256);
  let shift = 0;
  for (let b = 0; b < 256; b++) {
    table[b] = String.fromCharCode(keep.includes(b) ? b : 256 + shift++);
  }
  return table;
})();

const ranks = new Map<string, number>();
bpe.merges.forEach((pair, rank) => ranks.set(pair, rank));

const encoder = new TextEncoder();
const cache = new Map<string, number>();

/** How many tokens one pre-tokenized piece merges down to. */
function pieceTokens(piece: string): number {
  const hit = cache.get(piece);
  if (hit !== undefined) return hit;
  let parts: string[] = Array.from(encoder.encode(piece), (b) => BYTE_CHAR[b]!);
  while (parts.length > 1) {
    let best = Infinity;
    let at = -1;
    for (let i = 0; i < parts.length - 1; i++) {
      const rank = ranks.get(parts[i]! + ' ' + parts[i + 1]!);
      if (rank !== undefined && rank < best) {
        best = rank;
        at = i;
      }
    }
    if (at < 0) break;
    const [a, b] = [parts[at]!, parts[at + 1]!];
    const merged: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === a && parts[i + 1] === b) {
        merged.push(a + b);
        i++;
      } else merged.push(parts[i]!);
    }
    parts = merged;
  }
  if (cache.size >= CACHE_MOST) cache.clear();
  cache.set(piece, parts.length);
  return parts.length;
}

function gpt2Count(text: string): number {
  let n = 0;
  for (const m of text.matchAll(PRETOKENIZE)) n += pieceTokens(m[0]);
  return n;
}

function byteCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3; // includes a lone low surrogate, written as U+FFFD
  }
  return n;
}

export function tokenCounter(kind: Settings['oldVoiceTokenizer']): (text: string) => number {
  return kind === 'gpt2' ? gpt2Count : byteCount;
}
