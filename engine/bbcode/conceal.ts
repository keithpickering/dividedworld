/**
 * Empty what a post quotes of a post an admin hid. A quote copies the words it quotes, so once a version is hidden the copy is a way to read it
 * ("The System acts; it never destroys what a player wrote": the post's own words stay in the Act; what a player is shown is a layer over them).
 *
 * `concealQuotes(body, hidden)` reads the body with parse.ts, the one parser, so a quote is a quote of a hidden post exactly when the renderer would draw one:
 * a quote inside `[code]` or `[noparse]`, or with a name that is no Act's id is the post's own words and stays. A real quote nested past the depth limit is one too: the parser
 * cuts it (a `cut` node) and still reports its span, so its contents are emptied like any other, at any depth. It empties exactly
 * the contents of each such quote, between its opener (which keeps the id, so the renderer can say a hidden post was quoted) and its closer, and leaves every
 * other character as written: the parser reports where each quote's contents lie, and the body is cut there, never re-serialized from the tree.
 * A quote inside one already emptied is inside it. The function is pure and the cost is the parser's: one pass, linear in the body.
 */
import { parse, type QuoteSpan } from './parse.ts';

export function concealQuotes(body: string, hidden: ReadonlySet<string>): string {
  if (hidden.size === 0 || !/\[quote/i.test(body)) return body;
  const spans: QuoteSpan[] = [];
  parse(body, spans);
  const cuts = spans.filter((s) => hidden.has(s.act) && s.to > s.from).sort((a, b) => a.from - b.from || b.to - a.to);
  let out = '';
  let at = 0;
  for (const c of cuts) {
    if (c.from < at) continue; // inside a quote already emptied
    out += body.slice(at, c.from);
    at = c.to;
  }
  return out + body.slice(at);
}
