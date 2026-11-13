/**
 * Repair for a model's answer ("A validator tighter than the schema is a place a paid answer goes
 * to die").
 *
 * A provider's structured output cannot express a list length or a word count, so those bounds are
 * checked after the fact. A bound overshot by a little is the ordinary way a model treats "at most
 * six", so `repair` trims it (a list one or two over, a string over its length) and records each
 * trim as `{path, predicate, before, after}` for the call's ledger row. It rejects only what
 * cannot be repaired without inventing content: a missing required field, a wrong type, a value
 * outside its enum, a list far over its bound (cutting twelve to six keeps the first six of a
 * thing the model never meant to be cut), a list under its minimum. Every rejection names the
 * predicate that failed, so the ledger says which bound cost a paid answer, and carries the trims
 * made before it.
 *
 * A string over its bound is cut at a word (`cutAtWord`: the last whitespace within the bound where that keeps at least half of
 * it, else at the bound; a trailing comma, semicolon, colon or dash dropped), so a mood or an interest is not left mid-word (the
 * rehearsal patch design, section 7). `cutCompletion` caps at the bound as it always did.
 *
 * `cutCompletion` is the same for a raw completion: cut at the first stop sequence, the optional pattern's first match, or newline
 * (a slot that asks for many lines keeps its newlines), cap the length, and reject only empty output.
 *
 * Pure: the input is never changed; a repaired copy is returned.
 */

/** One bound that was overshot and trimmed: `before` and `after` are lengths. */
export interface Trim {
  readonly path: string;
  readonly predicate: string;
  readonly before: number;
  readonly after: number;
}

export type Rule =
  | { readonly type: 'string'; readonly maxLength?: number; readonly minLength?: number; readonly optional?: boolean }
  | { readonly type: 'number'; readonly optional?: boolean }
  /** Anything at all passes, unchanged: a field whose shape a later, kinder check owns (a wrong type there must not cost the answer). */
  | { readonly type: 'any'; readonly optional?: boolean }
  | { readonly type: 'boolean'; readonly optional?: boolean }
  | { readonly type: 'enum'; readonly values: readonly string[]; readonly optional?: boolean }
  | { readonly type: 'list'; readonly of: Rule; readonly max?: number; readonly min?: number; readonly optional?: boolean }
  | { readonly type: 'object'; readonly fields: Readonly<Record<string, Rule>>; readonly optional?: boolean };

export type Repaired =
  | { readonly ok: true; readonly value: unknown; readonly trims: readonly Trim[] }
  | { readonly ok: false; readonly path: string; readonly predicate: string; readonly trims: readonly Trim[] };

/** How far over its bound a list may be and still be trimmed; past it the model did not mean the bound. */
export const TRIM_LIST_BY = 2;

/** The first `most` UTF-16 units, dropping a high surrogate the cut would leave alone (Postgres jsonb refuses it). */
function capLength(text: string, most: number): string {
  const cut = text.slice(0, most);
  const last = cut.charCodeAt(cut.length - 1);
  if (!(last >= 0xd800 && last <= 0xdbff)) return cut;
  // Half an emoji is refused by Postgres, so the pair goes whole: dropped where text stays
  // before it, kept (one unit over the bound) where dropping it would leave nothing, since a
  // string that had text is never trimmed to empty.
  return cut.length > 1 ? cut.slice(0, -1) : text.slice(0, most + 1);
}

/**
 * `text` over `most`, cut at a word: the `capLength` head, then at the last whitespace in it where that keeps at least half of
 * `most` (no such space: the head as it is), with trailing whitespace and any of `,;:-–—` removed. Never empties a string that had text.
 */
export function cutAtWord(text: string, most: number): string {
  const head = capLength(text, most);
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'), head.lastIndexOf('\t'));
  const at = space >= most / 2 ? head.slice(0, space) : head;
  const trimmed = at.replace(/[\s,;:\-–—]+$/u, '');
  return trimmed === '' ? at : trimmed;
}

type Step = { ok: true; value: unknown } | { ok: false; path: string; predicate: string };

export function repair(value: unknown, rule: Rule): Repaired {
  const trims: Trim[] = [];
  const out = walk(value, rule, '', trims);
  return out.ok ? { ok: true, value: out.value, trims } : { ok: false, path: out.path, predicate: out.predicate, trims };
}

function walk(value: unknown, rule: Rule, path: string, trims: Trim[]): Step {
  const no = (predicate: string, at = path): Step => ({ ok: false, path: at, predicate });
  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') return no('isString');
      if (rule.minLength !== undefined && value.length < rule.minLength) return no(`atLeast(${rule.minLength})`);
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        const cut = cutAtWord(value, rule.maxLength);
        trims.push({ path, predicate: `maxLength(${rule.maxLength})`, before: value.length, after: cut.length });
        return { ok: true, value: cut };
      }
      return { ok: true, value };
    }
    case 'any':
      return { ok: true, value };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : no('isNumber');
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : no('isBoolean');
    case 'enum':
      return typeof value === 'string' && rule.values.includes(value) ? { ok: true, value } : no(`oneOf(${rule.values.join(', ')})`);
    case 'list': {
      if (!Array.isArray(value)) return no('isList');
      if (rule.min !== undefined && value.length < rule.min) return no(`atLeast(${rule.min})`);
      let items: unknown[] = value;
      if (rule.max !== undefined && items.length > rule.max) {
        if (items.length - rule.max > TRIM_LIST_BY) return no(`atMost(${rule.max})`);
        trims.push({ path, predicate: `atMost(${rule.max})`, before: items.length, after: rule.max });
        items = items.slice(0, rule.max);
      }
      const kept: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        const one = walk(items[i], rule.of, `${path}[${i}]`, trims);
        if (!one.ok) return one;
        kept.push(one.value);
      }
      return { ok: true, value: kept };
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return no('isObject');
      const given = value as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(rule.fields)) {
        const at = path ? `${path}.${key}` : key;
        if (given[key] === undefined || given[key] === null) {
          if (sub.optional) continue;
          return no('required', at);
        }
        const one = walk(given[key], sub, at, trims);
        if (!one.ok) return one;
        kept[key] = one.value;
      }
      return { ok: true, value: kept };
    }
  }
}

export type Cut =
  | { readonly ok: true; readonly text: string; readonly trims: readonly Trim[] }
  | { readonly ok: false; readonly predicate: string };

/**
 * Cuts at the first stop sequence or newline, whichever comes first, trims space, caps at `most`; only nothing is rejected.
 *
 * With `lines` of `'many'` (a slot that continues a text over several lines) a newline is no stop: the stops are
 * looked for in the answer as it came, so one that opens the answer cuts it to nothing; runs of more than two
 * newlines collapse to two; the end is trimmed; and of the leading whitespace one space is kept when the answer
 * began with a space (the continuation of "i think" needs it), never a newline.
 */
export function cutCompletion(text: string, stop: readonly string[], most: number, lines: 'one' | 'many' = 'one', pattern?: RegExp): Cut {
  const many = lines === 'many';
  // A raw completion often begins with a newline; leading whitespace is dropped before looking for the cut.
  const body = many ? text : text.trimStart();
  let end = body.length;
  for (const s of many ? stop : [...stop, '\n']) {
    if (s === '') continue;
    const at = body.indexOf(s);
    if (at !== -1 && at < end) end = at;
  }
  // The pattern's first match is one more stop, searched in the same body; a global or sticky flag is dropped so the search always starts at 0.
  if (pattern) {
    const at = body.search(new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')));
    if (at !== -1 && at < end) end = at;
  }
  let cut = many ? body.slice(0, end).replace(/(?:[ \t\r]*\n){3,}/g, '\n\n').trim() : body.slice(0, end).trim();
  if (cut === '') return { ok: false, predicate: 'nonEmpty' };
  // The one leading space a continuation keeps is part of the text the cap counts.
  if (many && text.startsWith(' ')) cut = ` ${cut}`;
  const trims: Trim[] = [];
  if (cut.length > most) {
    const before = cut.length;
    cut = capLength(cut, most);
    trims.push({ path: '', predicate: `maxLength(${most})`, before, after: cut.length });
  }
  return { ok: true, text: cut, trims };
}
