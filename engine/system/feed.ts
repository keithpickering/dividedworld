/**
 * Item titles out of a feed (system design, section 4): plain code reads outside material, no model searches the web.
 * An RSS 2.0 `<item><title>` or an Atom `<entry><title>` is read with a few patterns, not a parser, because a feed is
 * somebody else's markup and the meeting wants nothing from it but a title: no link is followed, no description kept,
 * no markup passed on. CDATA is unwrapped, the five XML entities and numeric references are decoded, tags inside a
 * title are dropped, whitespace is collapsed, and each title is cut to `most` characters. At most `limit` titles come
 * back; an empty title is skipped.
 *
 * Pure: it reads its arguments and nothing else.
 */

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1]!.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
}

/** The next `<name` at or after `from` whose name ends there (a space, `>` or `/` follows), or -1. */
function nextOpen(low: string, name: string, from: number): number {
  for (let i = low.indexOf(`<${name}`, from); i !== -1; i = low.indexOf(`<${name}`, i + 1)) {
    if (/[\s>/]/.test(low[i + name.length + 1] ?? '')) return i;
  }
  return -1;
}

/** The index of the `</name\s*>` at or after `from`, and the index just past it; null when there is none. */
function nextClose(low: string, name: string, from: number): [number, number] | null {
  for (let i = low.indexOf(`</${name}`, from); i !== -1; i = low.indexOf(`</${name}`, i + 1)) {
    let j = i + name.length + 2;
    while (j < low.length && /\s/.test(low[j]!)) j++;
    if (low[j] === '>') return [i, j + 1];
  }
  return null;
}

/**
 * The text of the first `<title>` between `from` and `to`, or null. The search runs on the item's own slice, never past
 * `to`: an indexOf over the whole document from inside every item is quadratic in the number of items, so a feed of
 * many title-less items would cost seconds.
 */
function innerTitle(low: string, xml: string, from: number, to: number): string | null {
  const seg = low.slice(from, to);
  const open = nextOpen(seg, 'title', 0);
  if (open === -1) return null;
  const end = seg.indexOf('>', open);
  if (end === -1) return null;
  const close = nextClose(seg, 'title', end + 1);
  return close ? xml.slice(from + end + 1, from + close[0]) : null;
}

export function feedTitles(xml: string, limit: number, most = 200): string[] {
  const out: string[] = [];
  // A linear scan, not a pattern: a feed of unclosed tags must not cost more than its length. Names are matched on an
  // ASCII-lowered copy, which keeps every index the same.
  const low = xml.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const names = ['item', 'entry'] as const;
  const next: number[] = [-2, -2];
  let pos = 0;
  while (out.length < limit) {
    // The next opening tag of either name, in document order; each name's position is looked for again only once passed.
    let which = -1;
    for (let k = 0; k < 2; k++) {
      if (next[k]! !== -1 && next[k]! < pos) next[k] = nextOpen(low, names[k]!, pos);
      if (next[k]! === -2) next[k] = nextOpen(low, names[k]!, pos);
      if (next[k]! !== -1 && (which === -1 || next[k]! < next[which]!)) which = k;
    }
    if (which === -1) break;
    const name = names[which]!;
    const open = next[which]!;
    const tagEnd = low.indexOf('>', open);
    if (tagEnd === -1) break;
    const close = nextClose(low, name, tagEnd + 1);
    // An opening tag with no close after it has no close for any later one of its name either.
    if (!close) break;
    pos = close[1];
    // A title is the first <title> inside the item or entry.
    const t = innerTitle(low, xml, tagEnd + 1, close[0]);
    if (t === null) continue;
    const inner = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_w, c: string) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    const title = decode(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (title !== '') out.push(title.length > most ? title.slice(0, most) : title);
  }
  return out;
}
