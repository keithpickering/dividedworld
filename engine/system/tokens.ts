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

/** GPT-2's published pre-tokenizing pattern (encoder.py), with `\p{L}`, `\p{N}` and `\p{White_Space}` for its
    classes: the reference's `\s` is Unicode White_Space, which JavaScript's `\s` is not (U+FEFF, U+0085). */
const PRETOKENIZE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\p{White_Space}\p{L}\p{N}]+|\p{White_Space}+(?!\P{White_Space})|\p{White_Space}+/gu;

/** The longest piece (in characters) the cache keeps. */
const CACHE_PIECE_MOST = 64;

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

/** A candidate merge of two neighbors, ordered by rank, then by the left symbol's place in the piece. */
interface Candidate {
  readonly key: number;
  readonly left: number;
  readonly right: number;
  readonly leftVersion: number;
  readonly rightVersion: number;
}

/** A binary min-heap on `key`. */
class Heap {
  private readonly items: Candidate[] = [];
  get size(): number {
    return this.items.length;
  }
  push(c: Candidate): void {
    const h = this.items;
    let i = h.push(c) - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (h[up]!.key <= c.key) break;
      h[i] = h[up]!;
      i = up;
    }
    h[i] = c;
  }
  pop(): Candidate {
    const h = this.items;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= h.length) break;
        if (child + 1 < h.length && h[child + 1]!.key < h[child]!.key) child++;
        if (h[child]!.key >= last.key) break;
        h[i] = h[child]!;
        i = child;
      }
      h[i] = last;
    }
    return top;
  }
}

const PLACE = 2 ** 21; // more than any piece's symbol count a post can reach, so the key never mixes rank and place

/**
 * How many symbols a piece merges down to. The lowest-ranked adjacent pair is merged first, the leftmost
 * of equals, which is the reference's order (and, for repeated characters, merges overlapping pairs left
 * to right). Symbols sit in a doubly linked list and the candidate pairs in a heap that is invalidated
 * lazily, so one long piece with no spaces costs O(n log n), never O(n^2).
 */
function mergeCount(symbols: string[]): number {
  const n = symbols.length;
  const next = new Int32Array(n);
  const prev = new Int32Array(n);
  const alive = new Uint8Array(n).fill(1);
  const version = new Int32Array(n);
  const heap = new Heap();
  for (let i = 0; i < n; i++) {
    next[i] = i + 1 < n ? i + 1 : -1;
    prev[i] = i - 1;
  }
  const offer = (l: number, r: number): void => {
    if (l < 0 || r < 0) return;
    const rank = ranks.get(symbols[l]! + ' ' + symbols[r]!);
    if (rank !== undefined) heap.push({ key: rank * PLACE + l, left: l, right: r, leftVersion: version[l]!, rightVersion: version[r]! });
  };
  for (let i = 0; i + 1 < n; i++) offer(i, i + 1);
  let count = n;
  while (heap.size > 0) {
    const c = heap.pop();
    const { left: l, right: r } = c;
    if (!alive[l] || !alive[r] || next[l] !== r || version[l] !== c.leftVersion || version[r] !== c.rightVersion) continue;
    symbols[l] = symbols[l]! + symbols[r]!;
    alive[r] = 0;
    const after = next[r]!;
    next[l] = after;
    if (after >= 0) prev[after] = l;
    version[l]!++;
    count--;
    offer(prev[l]!, l);
    offer(l, after);
  }
  return count;
}

/** How many tokens one pre-tokenized piece merges down to. */
function pieceTokens(piece: string): number {
  const hit = cache.get(piece);
  if (hit !== undefined) return hit;
  const n = mergeCount(Array.from(encoder.encode(piece), (b) => BYTE_CHAR[b]!));
  // A long piece is not kept: the entry bound alone would not bound the cache's memory, since a key can be
  // as long as a post, and a piece that long is almost never seen twice.
  if (piece.length <= CACHE_PIECE_MOST) {
    if (cache.size >= CACHE_MOST) cache.clear();
    cache.set(piece, n);
  }
  return n;
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

/**
 * The id of `text` when it is exactly one token of the instance's tokenizer, else null: the id a request's
 * `ban` names (`CompletionRequest.ban`). `gpt2` reads `encoder` in the vendored vocabulary through the
 * bytes-to-unicode table, so `' ---'` is the entry `Ġ---`; a text the vocabulary holds no single entry for
 * (two tokens, or none) is null. `bytes` has no ids, so it is always null and an instance on it sends no ban.
 */
export function tokenId(kind: Settings['oldVoiceTokenizer'], text: string): number | null {
  if (kind !== 'gpt2' || text === '') return null;
  const key = Array.from(encoder.encode(text), (b) => BYTE_CHAR[b]!).join('');
  const id = (bpe.encoder as Record<string, number>)[key];
  return id === undefined ? null : id;
}
