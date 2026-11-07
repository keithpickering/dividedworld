/**
 * A search snippet cut into runs. search_posts and search_threads mark the matched words in a snippet with `<<` and `>>`, plain characters
 * that no HTML is built from in SQL; the screen turns each run into an element (a matched word is a `mark`, never color alone).
 *
 * A marker is a marker only as a pair: the first `>>` after a `<<` closes it. A `>>` with no opener before it, and a `<<` with no closer after
 * it, are the text the post itself said. An opener inside a hit is part of the hit's text, since the first closer ends it.
 */
export interface SnippetPart {
  readonly text: string;
  /** Whether the search matched this run. */
  readonly hit: boolean;
}

export function snippetParts(snippet: string): readonly SnippetPart[] {
  const parts: { text: string; hit: boolean }[] = [];
  const add = (text: string, hit: boolean) => {
    if (text === '') return;
    const last = parts[parts.length - 1];
    if (!hit && last && !last.hit) last.text += text;
    else parts.push({ text, hit });
  };
  let at = 0;
  for (;;) {
    const open = snippet.indexOf('<<', at);
    const close = open < 0 ? -1 : snippet.indexOf('>>', open + 2);
    if (close < 0) break;
    add(snippet.slice(at, open), false);
    add(snippet.slice(open + 2, close), true);
    at = close + 2;
  }
  add(snippet.slice(at), false);
  return parts;
}
