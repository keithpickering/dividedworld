/**
 * Autocorrect (Pepperoni, common): the caster types a phrase and a replacement, and every occurrence of the phrase in the post,
 * whole words in any case, is covered by a strip of masking tape with the replacement written on it in marker
 * (docs/plans/2026-11-03-autocorrect-design.md; the tape, its peel and peek, and the half peel it saves are
 * docs/plans/2026-11-11-autocorrect-tape-design.md).
 * It is Minus World's signature spell, and the Jabroni's starter card.
 *
 * Its rules here are its bounds, where it lands, its price and the author's saved peels; the strips are the screens' to draw
 * (autocorrect/Effect.tsx). Both find the phrase with one matcher (autocorrect/match.ts) over the post's visible text, so the
 * strips the screens lay are the occurrences the server priced.
 *
 * A staff read (`covers`, engine/system/cover.ts) reads untouched tape as the board shows it: each occurrence is written over with the replacement, and
 * the sentence in `seen` says so. Once any peel is saved (a peeled place, a half peel, or `clean`) the author's tape is no longer what every reader sees,
 * so the read goes back to the words as written and `seen` describes the peel (docs/plans/2026-11-26-autocorrect-reads-design.md).
 *
 * - **The phrase** is 4 to 100 characters with at least 4 letters or digits (phrase-bound.ts), so tiny words cannot be carpet-bombed cheaply.
 * - **The replacement** is one line of plain text, 1 to 100 characters, and never the phrase itself (ignoring case). BBCode in
 *   it is kept as the text it is: the strip draws it as a string and never parses it.
 * - **It lands** only where its phrase is in the post's own words (a quote, code or a link is not; a cast whose phrase is not there
 *   is refused in plain words), up to three deep. The replacement is never the phrase as the matcher reads it (case-folded alike).
 * - **Its price** is the base price at the machine, plus `perVolume` for each `volumeStep` characters it covers (occurrences
 *   times the phrase's length), never more than `mostAdded` in all, as Whoops!'s long-post price is. Priced against the version
 *   the play was decided on; play_card refuses it if the post has another (0070), and strips then follow later edits for free.
 * - **Its state** is the post author's peels, by occurrence in the post's current version (the second "Mario" stays peeled),
 *   which every reader loads, and `clean` once none is left. A reader's own peels are never saved. `stuck` is what the author
 *   half-peeled: for a strip's place (a decimal string), the stretches of it still stuck, each `[from, to, edges]` in shares of
 *   the strip's length (to 4 places) with `edges` = `startKind * 3 + endKind`, a kind being 0 the strip's own end (only at share
 *   0 or 1), 1 a peel line where the roll waits, 2 a tear. A place is in `peeled` or in `stuck`, never both. `drops` is where
 *   the author's rolls fell: for a place in `stuck`, the shares of the strip's length (to 4 places, in order) where a rolled-up
 *   end was dropped, none strictly inside a stuck stretch of that place; it is kept only when some place holds one, and drops
 *   and stretches together are at most `STUCK.most`.
 *   The author's saves are held for `autocorrect.holdHours` after the play lands (`stateHeldUntil`; the act function refuses them
 *   before then, and the screens show the author the tape as a reader sees it); 0 holds none.
 */
import { economyOf, landsOn, ok, refuse, type Cover, type CardRules } from '../../../engine/rules/cards.ts';
import { occurrences, sameWords } from './autocorrect/match.ts';
import { LINE_BREAK, boundedPhrase, characters } from './phrase-bound.ts';
import type { Hundredths, Settings } from '../../../engine/rules/types.ts';
import { field, textField, who } from './seen-words.ts';

/** Whether the author has saved any peel: a peeled place, a half-peeled strip, or the tape washed clean. Untouched tape is what the board shows every reader. */
const holdsPeel = (state: unknown): boolean => {
  const peeled = field(state, 'peeled'), stuck = field(state, 'stuck');
  return (Array.isArray(peeled) && peeled.length > 0) || (typeof stuck === 'object' && stuck !== null && Object.keys(stuck).length > 0) || field(state, 'clean') === true;
};

/** Whether the play lays its strips in a staff read: its phrase and replacement are there and no peel is saved (`covers`, and the line that says so). */
const tapeShown = (config: unknown, state: unknown): boolean =>
  typeof field(config, 'phrase') === 'string' && typeof field(config, 'replacement') === 'string' && !holdsPeel(state);

export const REPLACEMENT = { most: 100 } as const;
/**
 * The most occurrences a saved peel can name: a post at the instance's longest (20,000 characters) holds at most 4,000 of the
 * shortest phrase with a space after each, and this leaves room above it. Its largest save fits effect_state's bound (cards.test.ts).
 */
export const PEELS = { most: 5000 } as const;
/** The most stretches and drops a save holds across all its strips; the largest save fits effect_state's bound (cards.test.ts). */
export const STUCK = { most: 2000 } as const;

/** A stretch of a strip still stuck: [from, to, edges], shares of its length to 4 places, edges = startKind * 3 + endKind (0 the strip's own end, 1 a peel line, 2 a tear). */
export type Stretch = readonly [from: number, to: number, edges: number];

export type AutocorrectConfig = { readonly phrase: string; readonly replacement: string };

export const autocorrect: CardRules<AutocorrectConfig> = {
  key: 'autocorrect',
  name: 'Autocorrect',
  alignment: 'pepperoni',
  rarity: 'common',
  setPhrase: (config) => config.phrase,
  stack: 3,
  /** What the tape's screens read: how fast a strip peels (px a second), the hold before a pick (ms), a drag's give (px), how long a peeked corner stays (ms) and settles back (px a second). */
  screenReads: [
    { key: 'autocorrect.pace', whole: true, min: 20, max: 400 },
    { key: 'autocorrect.pickMs', whole: true, min: 0, max: 2000 },
    { key: 'autocorrect.give', whole: true, min: 8, max: 200 },
    { key: 'autocorrect.peekStayMs', whole: true, min: 0, max: 5000 },
    { key: 'autocorrect.peekSettle', whole: true, min: 20, max: 2000 },
  ],
  reads: [{ key: 'autocorrect.perVolume', whole: true, min: 0 }, { key: 'autocorrect.volumeStep', whole: true, min: 1 }, { key: 'autocorrect.mostAdded', whole: true, min: 1 }, { key: 'autocorrect.holdHours', whole: true, min: 0, max: 168 }],
  seen: (p) => {
    const phrase = textField(p.config, 'phrase', 80), replacement = textField(p.config, 'replacement', 80);
    const tape = phrase !== null && replacement !== null ? `every “${phrase}” in this post in masking tape with “${replacement}” scrawled across it in marker` : 'the words it names in this post in strips of masking tape with other words scrawled across them in marker';
    const peeled = field(p.state, 'peeled'), stuck = field(p.state, 'stuck');
    const loose = Array.isArray(peeled) ? peeled.length : 0, half = typeof stuck === 'object' && stuck !== null ? Object.keys(stuck).length : 0;
    const rest = field(p.state, 'clean') === true ? ' Every strip has been peeled away.' : loose > 0 ? ' Some of the tape has been peeled off, leaving the words under it bare.' : half > 0 ? ' A strip has been half peeled, and hangs by a corner.'
      : !tapeShown(p.config, p.state) ? '' : ` The post above reads as the tape shows it; the marker words are ${typeof p.by === 'string' && p.by.trim() !== '' ? `${p.by}'s` : "not the post's own"}.`;
    return `${who(p)} taped over ${tape}, ${p.ago}.${rest}`;
  },
  covers: (p) => {
    if (!tapeShown(p.config, p.state)) return null;
    const phrase = field(p.config, 'phrase') as string, replacement = field(p.config, 'replacement') as string;
    return occurrences(p.text, phrase).map(({ from, to }): Cover => ({ from, to, words: replacement }));
  },
  playPrice: (settings, target, config) => {
    if (target.reach !== 'post') return 0;
    const room = economyOf(settings, 'autocorrect.mostAdded');
    // A face asks the most a play could add, before anyone has typed a phrase (engine/ui/cards/faces.ts).
    if (typeof config?.phrase !== 'string') return Math.max(0, room);
    const volume = occurrences(target.text, config.phrase).length * characters(config.phrase);
    return Math.max(0, Math.min(economyOf(settings, 'autocorrect.perVolume') * Math.floor(volume / economyOf(settings, 'autocorrect.volumeStep')), room));
  },
  canApply: (target, effects, config, now) => {
    const lands = landsOn(autocorrect, target, effects, now);
    // The screens ask with whatever the form holds, which before a phrase is typed (or from another card's form) has none.
    if (!lands.ok || typeof config?.phrase !== 'string' || target.reach !== 'post') return lands;
    return occurrences(target.text, config.phrase).length ? lands : refuse(`“${config.phrase}” is not in this post's own words`);
  },
  staffOptions: {
    prompt: 'Choose the words to cover and what to cover them with. The phrase must be copied exactly from the post you are replying to: whole words, on one line, at least 4 letters or digits and up to 100 characters. The replacement is one line of other words, up to 100 characters.',
    schema: { type: 'object', properties: { phrase: { type: 'string' }, replacement: { type: 'string' } }, required: ['phrase', 'replacement'], additionalProperties: false },
  },
  validateConfig: (config) => {
    const { phrase: p, replacement: r } = typeof config === 'object' && config !== null ? (config as { phrase?: unknown; replacement?: unknown }) : {};
    if (typeof p !== 'string') return refuse('the phrase is the words to cover');
    if (typeof r !== 'string') return refuse('the replacement is the words to cover them with');
    const bounded = boundedPhrase(p);
    if (!bounded.ok) return refuse(bounded.why);
    const { phrase } = bounded;
    const replacement = r.trim();
    if (!replacement) return refuse('the replacement is some words, not nothing');
    if (characters(replacement) > REPLACEMENT.most) return refuse(`the replacement is at most ${REPLACEMENT.most} characters`);
    if (LINE_BREAK.test(replacement)) return refuse('the replacement is one line');
    if (sameWords(phrase, replacement)) return refuse('the replacement is other words, not the phrase itself');
    return ok({ phrase, replacement });
  },
  stateHeldUntil: (settings, landed) => holdEnds(economyOf(settings, 'autocorrect.holdHours'), landed),
  stateHeldWords: (until) => `This tape is stuck on until ${until}. It can be peeled after that.`,
  /** Its effect is drawn on the post and counts toward the post's limit of drawn effects (`postEffects`); tape washed clean fades for everyone and stops counting. */
  drawsEffect: { cleared: (state) => typeof state === 'object' && state !== null && (state as { clean?: unknown }).clean === true },
  validateState: (state) => {
    const { peeled, clean, stuck, drops } = typeof state === 'object' && state !== null ? (state as { peeled?: unknown; clean?: unknown; stuck?: unknown; drops?: unknown }) : {};
    if (!Array.isArray(peeled)) return refuse('peeled is a list of places');
    if (clean !== undefined && typeof clean !== 'boolean') return refuse('clean is true or false');
    if (!peeled.every((n) => Number.isSafeInteger(n) && n >= 0 && n < PEELS.most)) return refuse(`a place is a whole number from 0 to ${PEELS.most - 1}`);
    const kept = [...new Set(peeled as number[])].sort((a, b) => a - b);
    let keptStuck: Record<string, Stretch[]> | undefined;
    if (stuck !== undefined) {
      if (typeof stuck !== 'object' || stuck === null || Array.isArray(stuck)) return refuse('stuck is a list of stretches for each place');
      const places = new Set(kept);
      const out: Record<string, Stretch[]> = {};
      let total = 0;
      for (const [key, stretches] of Object.entries(stuck)) {
        const place = Number(key);
        if (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(place) || place >= PEELS.most) return refuse(`a place is a whole number from 0 to ${PEELS.most - 1}`);
        if (places.has(place)) return refuse('a place is in peeled or in stuck, never both');
        if (!Array.isArray(stretches)) return refuse('stuck holds a list of stretches for each place');
        if (!stretches.length) return refuse('a place in stuck holds at least one stretch');
        total += stretches.length;
        if (total > STUCK.most) return refuse(`a save holds at most ${STUCK.most} stretches and drops`);
        const rounded: Stretch[] = [];
        for (const s of stretches) {
          if (!Array.isArray(s) || s.length !== 3 || !s.every((n) => typeof n === 'number')) return refuse('a stretch is [from, to, edges], three numbers');
          const [from, to, edges] = s as [number, number, number];
          if (!(from >= 0 && from <= 1 && to >= 0 && to <= 1)) return refuse('a share is from 0 to 1');
          if (!Number.isInteger(edges) || edges < 0 || edges > 8) return refuse('edges is a whole number from 0 to 8');
          const [a, b] = [Math.round(from * 10_000) / 10_000, Math.round(to * 10_000) / 10_000];
          if (!(a < b)) return refuse('a stretch is from before to');
          if (Math.floor(edges / 3) === 0 && a !== 0) return refuse("a stretch starts at the strip's own end only at share 0");
          if (edges % 3 === 0 && b !== 1) return refuse("a stretch ends at the strip's own end only at share 1");
          const last = rounded[rounded.length - 1];
          if (last && a < last[1]) return refuse('a place\'s stretches are in order and do not overlap');
          rounded.push([a, b, edges]);
        }
        out[key] = rounded;
      }
      if (total) keptStuck = out;
    }
    let keptDrops: Record<string, number[]> | undefined;
    if (drops !== undefined) {
      if (typeof drops !== 'object' || drops === null || Array.isArray(drops)) return refuse('drops is a list of shares for each place');
      const out: Record<string, number[]> = {};
      let total = Object.values(keptStuck ?? {}).reduce((n, list) => n + list.length, 0);
      for (const [key, shares] of Object.entries(drops)) {
        const held = keptStuck && Object.hasOwn(keptStuck, key) ? keptStuck[key] : undefined;
        if (!held) return refuse('a place in drops is in stuck');
        if (!Array.isArray(shares)) return refuse('drops holds a list of shares for each place');
        total += shares.length;
        if (total > STUCK.most) return refuse(`a save holds at most ${STUCK.most} stretches and drops`);
        let last = -1;
        for (const share of shares) {
          if (typeof share !== 'number' || !(share >= 0 && share <= 1)) return refuse('a share is from 0 to 1');
          if (Math.round(share * 10_000) / 10_000 !== share) return refuse('a share is given to 4 places');
          if (!(share > last)) return refuse("a place's drops are in order, each after the one before");
          if (held.some(([from, to]) => from < share && share < to)) return refuse('a drop is not inside a stretch that is still stuck');
          last = share;
        }
        if (shares.length) out[key] = [...shares] as number[];
      }
      if (Object.keys(out).length) keptDrops = out;
    }
    return ok({ peeled: kept, ...(clean === undefined ? {} : { clean }), ...(keptStuck ? { stuck: keptStuck } : {}), ...(keptDrops ? { drops: keptDrops } : {}) });
  },
};

/** When a hold of `hours` on a play that landed at `landed` ends; undefined for no hold (0). The server's rule and the screens' preview both read it. */
function holdEnds(hours: number, landed: Date): Date | undefined {
  return hours > 0 ? new Date(landed.getTime() + hours * 3_600_000) : undefined;
}

/**
 * When the author's hold on a play that landed at `playedAt` (an ISO time) ends, for the screens, which hold only the economy of the settings;
 * undefined for no hold, an unparsable time, or an economy without the setting (the screens only preview; the act function refuses the save).
 */
export function heldUntil(settings: { readonly economy: Readonly<Record<string, number>> }, playedAt: string): Date | undefined {
  const landed = new Date(playedAt), hours = settings.economy['autocorrect.holdHours'];
  return Number.isNaN(landed.getTime()) || typeof hours !== 'number' || !Number.isFinite(hours) ? undefined : holdEnds(hours, landed);
}

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
