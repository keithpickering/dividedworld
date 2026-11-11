/**
 * The old-voice scrubber. A persona on the old voice writes with a raw base model (2019 to 2021) nobody has tuned, so
 * its completion is checked before it can become a post: it must carry no listed word, no email address, no web
 * address and no phone number. It is a moderation blocklist, and the instance's list is `SystemContent.scrubWords`.
 *
 * `scrubHit` names the first predicate that hits, in this order: `word`, `email`, `url`, `phone`; `null` is clean.
 * - `word`: the text is folded (lower case; 0 to o, 1 to i, 3 to e, 4 to a, 5 to s, 7 to t, @ to a, $ to s) and each
 *   entry (folded the same way) is matched at word boundaries, so "Superman" holds neither "man" nor "super". A space in
 *   an entry matches any run of whitespace. Compiled once per words array.
 * - `email`, `url`, `phone` read the raw text. A `url` is a scheme, `www.`, or a dotted host ending in a known TLD
 *   (so "1.2.3", "e.g." and "end.Next" are clean); a `phone` is seven or more digits in one run of digits and the usual
 *   separators (space, hyphen, dot, parentheses, a leading +), so a year is clean and "12345678" is not (accepted).
 *
 * `scrubbedComplete` asks again once on a hit (each call keeps its own ledger row, inside `models.complete`), and a
 * second hit is a rejected answer ("A validator tighter than the schema…": a rejection costs a refund, so the one retry
 * comes first). An error or rejection from `models.complete` itself passes through untouched.
 */
import type { CompletionRequest, ModelResult, Models } from './model.ts';
import { AnswerRejected } from './model.ts';

const SWAPS: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Lower case with the letter-for-digit swaps applied, one character for one, so lengths hold. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[013457@$]/g, (c) => SWAPS[c] ?? c);
}

const BOUNDED = (alt: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'u');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compiled = new WeakMap<readonly string[], RegExp | null>();
function wordRegex(words: readonly string[]): RegExp | null {
  if (compiled.has(words)) return compiled.get(words)!;
  const alts = words.map((w) => fold(w.trim())).filter((w) => w !== '').map((w) => w.split(/\s+/).map(escape).join('\\s+'));
  const rx = alts.length ? BOUNDED(alts.join('|')) : null;
  compiled.set(words, rx);
  return rx;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const TLDS = 'com|net|org|io|co|gg|tv|me|info|biz|edu|gov|us|uk|ca|de|fr|ru|jp|xyz|app|dev|ly|to|cc';
const URL_RX = new RegExp(`(?:\\b[a-z][a-z0-9+.-]*://|\\bwww\\.)|(?<![a-z0-9-])(?:[a-z0-9][a-z0-9-]+\\.)+(?:${TLDS})(?![a-z0-9])`, 'i');
const DIGIT_RUN = /\+?\(?\d[\d\s().-]*/g;

function hasPhone(text: string): boolean {
  for (const run of text.matchAll(DIGIT_RUN)) if (run[0].replace(/\D/g, '').length >= 7) return true;
  return false;
}

/** The first predicate a text hits (`word`, `email`, `url`, `phone`), or null when it is clean. */
export function scrubHit(text: string, words: readonly string[]): string | null {
  const rx = wordRegex(words);
  if (rx && rx.test(fold(text))) return 'word';
  if (EMAIL.test(text)) return 'email';
  if (URL_RX.test(text)) return 'url';
  if (hasPhone(text)) return 'phone';
  return null;
}

/** A completion that passes the scrubber: one more try on a hit, and a rejection when that hits too. */
export async function scrubbedComplete(models: Models, request: CompletionRequest, words: readonly string[]): Promise<ModelResult<string>> {
  let hit: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await models.complete(request);
    hit = scrubHit(out.value, words);
    if (hit === null) return out;
  }
  throw new AnswerRejected('the completion failed the scrubber', `scrub:${hit}`);
}
