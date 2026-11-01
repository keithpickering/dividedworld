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

export function feedTitles(xml: string, limit: number, most = 200): string[] {
  const out: string[] = [];
  // Items, or entries, in document order; a title is the first <title> inside one.
  const item = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (let m: RegExpExecArray | null; out.length < limit && (m = item.exec(xml)); ) {
    const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(m[2]!);
    if (!t) continue;
    const inner = t[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_w, c: string) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    const title = decode(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (title !== '') out.push(title.length > most ? title.slice(0, most) : title);
  }
  return out;
}
