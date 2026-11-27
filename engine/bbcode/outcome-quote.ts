/**
 * The quote a Mod's outcome post opens with (docs/plans/2026-11-27-outcome-quotes-plan.md, "Decided here"): a real `[quote=<act>]` of the target's opening words, then a line break, in the
 * form a player's quote is written (`quoteText`, engine/ui/composer/text.ts). The words are a selection's: the words the forged-quote check reads from the target's current version (`quoteSource`, quoted.ts: links, code, nested quotes and a spoiler's title included; normalized; the first run before any cut mark),
 * all of them when they fit and otherwise the first `OUTCOME_QUOTE_MOST` characters cut at a word, followed by `…` (which `quoteNorm` drops, so the forged-quote check holds). They are
 * wrapped in `[noparse]` when they hold what reads as a tag (`asTyped`, quoted.ts), as a selection's are. The database's `outcome_quote` is this, in plain SQL; the fake's copy is this function, held to the same cases.
 */
import { parse } from './parse.ts';
import { CUT, asTyped, quoteSource } from './quoted.ts';

/** The most words an outcome's quote holds before the cut mark. */
export const OUTCOME_QUOTE_MOST = 280;

/**
 * The quote to write ahead of an outcome post's words, or an empty string where `room` leaves none for even one word, or the target says nothing. `body` is the target's current version's body as written, with its markup.
 *
 * `room` is how many characters the words, their `…` and their `[noparse]` cover may take in all: the caller has taken the fixed 53 of the markup (`[quote=`, the 36-character id, `]`, `[/quote]`, the line break) out already,
 * and the words shrink until the three fit. The database's `outcome_quote(target, room)` is the same contract, held to the same table of cases.
 *
 * The words open at the target's own: where the version opens (after whitespace) with a `[quote…]…[/quote]`, its words are dropped from the front and the quote is of what follows, as long as what follows is still a verbatim run of
 * the source (so a ban entry's ruling quotes "Banned: …" and not the tipped post's words it opens with). A quote with nothing after it is quoted as it stands.
 */
export function outcomeQuote(target: string, body: string, room: number = Number.MAX_SAFE_INTEGER): string {
  const most = Math.min(OUTCOME_QUOTE_MOST, Math.floor(room));
  const firstRun = (src: string): string => src.split(CUT).map((p) => p.trim()).find((p) => p !== '') ?? '';
  const source = quoteSource(parse(body));
  let plain = firstRun(source);
  const rest = withoutLeadingQuote(body);
  if (rest !== body) {
    const after = firstRun(quoteSource(parse(rest)));
    if (after !== '' && source.includes(after)) plain = after;
  }
  if (most < 1 || plain === '') return '';
  // Counted and cut by code points, as the database counts, so a pair of UTF-16 units is never split.
  const cps = Array.from(plain);
  let lim = most;
  for (;;) {
    let words = plain;
    if (cps.length > lim) {
      const head = cps.slice(0, lim + 1);
      const at = head.lastIndexOf(' ');
      const cut = (at > 0 ? head.slice(0, at) : cps.slice(0, lim)).join('').trimEnd();
      words = `${cut === '' ? cps.slice(0, lim).join('') : cut}…`;
    }
    const kept = asTyped(words);
    const over = Array.from(kept).length - Math.floor(room);
    if (over <= 0) return `[quote=${target}]${kept}[/quote]\n`;
    lim -= over;
    if (lim < 1) return '';
  }
}

/**
 * A body without the real quote it opens with, nested quotes inside it gone too: what an outcome post says in the Mod's own words, where a screen shows its opening words (the Lens row). A body that
 * does not open with a quote, or whose opening quote is never closed, is returned as it stands.
 */
export function withoutLeadingQuote(body: string): string {
  const lead = /^\s*\[quote(?:=[^\]]*)?\]/iu.exec(body);
  if (lead === null) return body;
  let depth = 0;
  for (const m of body.matchAll(/\[(\/)?quote(?:=[^\]]*)?\]/giu)) {
    depth += m[1] === undefined ? 1 : -1;
    if (depth === 0) return body.slice(m.index! + m[0].length).replace(/^\s*\n/u, '');
  }
  return body;
}
