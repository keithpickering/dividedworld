/**
 * What the meeting does with a persona's arc (fangame split design, sections 1, 2, 3, 5 and 9; the plan, Task 6). Pure, and the engine's: nothing here names a community.
 *
 * **An arc is a secret, even from the Boss.** The database says which beats are unlocked and unplayed (`arc_for_meeting`, 0333); `shownBeats` joins them to the persona's own file by
 * key, so a beat the database does not list never reaches this module with its brief, and `beatsText` is the only place a brief is written into a prompt. A locked beat's brief, key or
 * slot is in no prompt, and a held-back kind is in no list (`meetingSystemPrompt` filters it).
 *
 * **A beat is the Boss's, and the code bounds it.** The Boss answers a beat as `{beat, slots, why}`. A slot is a param the template leaves to the Boss; what the Boss writes there is repaired
 * (a string over its kind's bound is trimmed and recorded, a board's name is held to the instance's name style and `boardNameMaxLength`, a value the template has no slot for is dropped and
 * recorded) and a slot left out, or one that cannot be repaired without inventing content (a name outside the style), is the writer's default, recorded. A beat's bundle is authored: it costs
 * the bank nothing. A due beat the answer leaves out is played with every default, and the record says so.
 *
 * **A beat with no bundle** (a brief that is played with the Boss's ordinary moves) is played by naming it, `{beat, why}`, which costs nothing and carries no parts; until then its brief is shown
 * at every meeting, and it lapses at the season's end if it is never played.
 *
 * Roles in a bundle's parts (`{role}`, or `{role, beat}` for a board an earlier beat's bundle made) name boards that do not exist yet: the engine keeps them as written, and the database
 * resolves them when each part lands. A bundle's parts are queued in dependency order, so a role always names an earlier part.
 */
import type { BundleTemplate, Beat, Persona } from '../rules/types.ts';
import { moveKind, moveParamsProblems, ROLE, UUID, type MachineLimits } from './moves.ts';
import type { HandoffFacts, PlannedMove } from './meeting.ts';
import { cutAtSentence } from './chatter.ts';
import { repair, type Rule, type Trim } from './validate.ts';

/** What `meeting_context().arc` says (0334, over arc_for_meeting, 0333): the beats unlocked and not yet played, in the persona's order, and the kinds held back now. */
export interface ArcRead {
  /** An aftermath beat is listed by its plain key with `aftermath: true` and `predecessor`, the staff key of the Boss whose file holds it (arc announcements design, section 7). */
  readonly beats: readonly { readonly key: string; readonly mini: boolean; readonly due: boolean; readonly aftermath?: boolean; readonly predecessor?: string }[];
  readonly heldBack: readonly string[];
  /** The lead-ins live now (section 6): the key of a beat of the Boss's own file, or `after:<predecessor>:<key>` for an aftermath beat's. Absent from an older database: none. */
  readonly leadIns?: readonly string[];
}

/** A beat the meeting is shown: the persona's own beat, and whether it is past its due point (it "must be played at this meeting"). An aftermath beat is the predecessor's, written for any successor. */
export interface ShownBeat {
  readonly beat: Beat;
  readonly mini: boolean;
  readonly due: boolean;
  readonly aftermath?: boolean;
}

/** The part of a persona's file that carries a predecessor's aftermath beats: what the meeting looks one up in. */
export type AftermathFile = Pick<Persona, 'key' | 'aftermath'>;

/** A part of a bundle as it is queued: an ordinary move, with its role when another part (or a later beat) names it. */
export interface PlannedPart extends Omit<PlannedMove, 'line'> {
  readonly role: string | null;
}

/** A bundle as the meeting queues it. `beat` is the beat it plays (authored: it costs nothing), or null for a bundle the Boss composed (it costs `cost`, one move a part). A beat with no bundle has no parts. */
export interface PlannedBundle {
  readonly name: string;
  readonly beat: string | null;
  readonly parts: readonly PlannedPart[];
  readonly cost: number;
}

/** The owner's words, exactly: nothing else about beats is said in a prompt, and nothing about a beat not yet unlocked. */
export const BEAT_WORDS = 'A beat is yours: an idea you have had. Play it when the board is ready, in your own words.';
export const BUNDLE_WORDS = 'A bundle is for moves that tell one story.';

/** Why a bundle's parts carry when the Boss left a due beat out of its answer. Plain: an admin reads it in the queue. */
export const DUE_WHY = 'This beat was due and the meeting left it out, so it was played with its defaults.';
/** Why a beat's parts carry when the Boss named the beat and gave no reason. */
export const BEAT_WHY = 'The Boss played this beat.';

/** The bounds on a beat's announcement and lead-in, in characters (the arc announcements design, sections 2, 3, 6 and 8): authored text is checked against them, and the meeting trims what a model writes to them. */
export const ANNOUNCE_MOST = 2000;
export const PITCH_MOST = 200;
export const RECAP_MOST = 300;
/** The most initiatives the plot so far lists, the latest; a prompt stays bounded whatever the context sends. */
export const PLOT_INITIATIVES_MOST = 8;
export const PUSH_MOST = 300;
export const MOOD_MOST = 300;
export const LEAD_IN_BRIEF_MOST = 1000;

/** The params of the moves that build the board where a role may stand for a board's uuid, as the guard reads them. */
const BOARD_PARAMS = ['board', 'into', 'fallback'] as const;

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The beats to show: those the database lists (unlocked, unplayed), found by key in the persona's arc and then its mini-arcs, in the database's order. An aftermath beat is found by its plain key
 * in the persona file of the predecessor the database names, among `roster`'s files; a predecessor no longer on the roster shows none. A key the persona does not hold (the instance changed
 * since the seed) is left out. Nothing the database did not list is ever returned: this is where a locked beat stays secret.
 */
export function shownBeats(persona: Pick<Persona, 'arc' | 'miniArcs'>, read: ArcRead | undefined, roster: readonly AftermathFile[] = []): ShownBeat[] {
  if (!read) return [];
  const out: ShownBeat[] = [];
  for (const r of read.beats) {
    if (r.aftermath) {
      const beat = roster.find((p) => p.key === r.predecessor)?.aftermath?.find((b) => b.key === r.key);
      if (beat) out.push({ beat, mini: r.mini, due: r.due, aftermath: true });
      continue;
    }
    const beat = (persona.arc ?? []).find((b) => b.key === r.key) ?? (persona.miniArcs ?? []).find((b) => b.key === r.key);
    if (beat) out.push({ beat, mini: r.mini, due: r.due });
  }
  return out;
}

/** A lead-in's beat by the key `arc_for_meeting` lists it under: the persona's own beat, or `after:<predecessor>:<key>` in the predecessor's aftermath. Undefined where the file no longer holds it. */
function leadInBeat(persona: Pick<Persona, 'arc' | 'miniArcs'>, key: string, roster: readonly AftermathFile[]): Beat | undefined {
  const m = /^after:([^:]+):(.+)$/.exec(key);
  if (m) return roster.find((p) => p.key === m[1])?.aftermath?.find((b) => b.key === m[2]);
  return (persona.arc ?? []).find((b) => b.key === key) ?? (persona.miniArcs ?? []).find((b) => b.key === key);
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A slot as the Boss reads it: `role.slot (hint)`. */
const slotsOf = (t: BundleTemplate): string[] =>
  t.parts.flatMap((p) => Object.entries(p.slots ?? {}).map(([name, s]) => `${p.role}.${name} (${oneLine(s.hint)})`));

/**
 * The section of the prompt about beats, or nothing when none is unlocked. The owner's three sentences open it; each beat then follows with its brief, and how to answer it. A due beat
 * says so. Slots are shown with their hints; a part with none shows none. A beat with an `announce` block also says that playing it opens a sticky thread on the staff board in the Boss's name, and
 * the title's hint and the bounds of the three fields (the arc announcements design, section 3); a beat with none says nothing new. `titleMax` is `Settings.titleMaxLength`.
 */
export function beatsText(beats: readonly ShownBeat[], titleMax: number): string[] {
  if (beats.length === 0) return [];
  const lines = beats.map((b) => {
    const head = `- ${b.beat.key}${b.due ? ' (must be played at this meeting)' : ''}: ${oneLine(b.beat.brief)}`;
    const say = b.beat.announce
      ? `\n  Playing it opens a sticky thread on the staff board in your name. Write it in this beat's announce: {title, body, pitch}. title: at most ${titleMax} characters; ${oneLine(b.beat.announce.titleHint)}. body: your announcement post, in your own voice, at most ${ANNOUNCE_MOST} characters. pitch: the initiative in one line, at most ${PITCH_MOST} characters; it is the line every staff member will carry. A field you leave blank is the writer's own words.`
      : '';
    if (!b.beat.bundle) return `${head}\n  Name it in "beats" with {beat: "${b.beat.key}", why} when you have played it.${say}`;
    const slots = slotsOf(b.beat.bundle);
    return `${head}\n  Play it in "beats" with {beat: "${b.beat.key}", slots: [{slot, value}], why}, which plays "${oneLine(b.beat.bundle.name)}". ${slots.length ? `Write each slot you fill as one entry of slots, {slot: "role.slot", value: your words, or a number's digits}, and leave out the ones you do not fill. Its slots: ${slots.join('; ')}.` : 'It has no slots to fill.'}${say}`;
  });
  const announced = beats.some((b) => b.beat.announce);
  return [[`${BEAT_WORDS} ${BUNDLE_WORDS}`, ...lines, ...(announced ? ['Every entry of "beats" carries an announce; for a beat above that has no announce, write it with blank fields.'] : [])].join('\n')];
}

/* ------------------------------------------------------------------------------ announcements ---- */

/** What a beat's announcement is as the meeting plans it: the beat (the key its beats answer used), the three fields as repaired, and the block's `push`, which the Boss's pool calls carry (section 5). */
export interface PlannedAnnouncement {
  readonly beat: string;
  readonly title: string;
  readonly body: string;
  readonly pitch: string;
  readonly push: string;
}

const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

/**
 * A beat's announcement from what the Boss wrote at `path` (the answer's path for the beat), or the block's defaults where `given` is `'defaults'` (a due beat played with them). A blank or missing
 * field is the block's default, recorded (`defaulted`); a field over its bound is cut at a sentence, else a word (`cutAtSentence`), and the trim recorded. A beat with no block has none: what the
 * Boss wrote there, if it wrote any words, is dropped and recorded (`hasAnnounce`). Nothing given is changed.
 */
export function announceRepair(beat: Beat, given: unknown, titleMax: number, path: string): { readonly announcement: PlannedAnnouncement | null; readonly trims: readonly Trim[] } {
  const trims: Trim[] = [];
  const asked = given === 'defaults' ? {} : record(given);
  const block = beat.announce;
  if (!block) {
    if (['title', 'body', 'pitch'].some((f) => !blank(asked[f]))) trims.push({ path: `${path}.announce`, predicate: 'hasAnnounce', before: 1, after: 0 });
    return { announcement: null, trims };
  }
  const field = (name: 'title' | 'body' | 'pitch', fallback: string, most: number): string => {
    const at = `${path}.announce.${name}`;
    let v: string;
    if (blank(asked[name])) {
      v = fallback.trim();
      if (given !== 'defaults') trims.push({ path: at, predicate: 'defaulted', before: 0, after: 1 });
    } else v = (asked[name] as string).trim();
    if (name !== 'body') v = oneLine(v);
    if (v.length > most) {
      const cut = cutAtSentence(v, most);
      trims.push({ path: at, predicate: `maxLength(${most})`, before: v.length, after: cut.length });
      v = cut;
    }
    return v;
  };
  return {
    announcement: {
      beat: beat.key,
      title: field('title', block.defaultTitle, titleMax),
      body: field('body', block.defaultBody, ANNOUNCE_MOST),
      pitch: field('pitch', block.defaultPitch, PITCH_MOST),
      push: block.push,
    },
    trims,
  };
}

/* ------------------------------------------------------------------- lead-ins and the plot ---- */

/**
 * The lead-in section of the Boss's meeting (section 6): for each lead-in the database lists live, its brief, framed as how the Boss has been feeling lately and never as a plan. A key the file
 * does not hold, or a beat with no lead-in, is nothing; a beat the database does not list is not in the file's read at all, so its brief never reaches a prompt. Neither the beat's key nor its own brief is written.
 */
export function leadInText(persona: Pick<Persona, 'arc' | 'miniArcs'>, keys: readonly string[] | undefined, roster: readonly AftermathFile[] = []): string[] {
  const briefs = (keys ?? []).flatMap((k) => {
    const lead = leadInBeat(persona, k, roster)?.leadIn;
    return lead ? [oneLine(lead.brief)] : [];
  });
  if (briefs.length === 0) return [];
  return [['How you have been feeling lately. It is a worry you have not decided what to do about, and you may let it show in what you say and decide.', ...briefs.map((b) => `- ${b}`)].join('\n')];
}

/** The mood lines of the lead-ins live now, for the Boss's pool calls (section 6): the same lookup as `leadInText`. */
export function leadInMoods(persona: Pick<Persona, 'arc' | 'miniArcs'>, keys: readonly string[] | undefined, roster: readonly AftermathFile[] = []): string[] {
  return (keys ?? []).flatMap((k) => {
    const lead = leadInBeat(persona, k, roster)?.leadIn;
    return lead ? [oneLine(lead.mood)] : [];
  });
}

/** What `meeting_context().plot` says (section 5 and 8): last season's Boss and recap, and the season's announced initiatives. The recap is null where the last meeting wrote none. */
export interface PlotRead {
  readonly last: { readonly boss: string; readonly name: string; readonly recap: string | null; readonly facts: HandoffFacts | null } | null;
  readonly initiatives: readonly { readonly beat: string; readonly title: string; readonly pitch: string; readonly thread: string; readonly boss: string }[];
}

/**
 * One plain line from the handoff's facts, for a season whose last meeting wrote no recap (section 8): who led and what the code counted. Only ever read inside a prompt, at most `RECAP_MOST`.
 */
export function recapFallback(facts: HandoffFacts, bossName: string): string {
  const n = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const name = (s: string): string => oneLine(s).slice(0, 60);
  const made = [facts.created.length ? `${n(facts.created.length, 'board')} made` : '', facts.merged.length ? `${facts.merged.length} merged` : '', facts.closed.length ? `${facts.closed.length} closed` : ''].filter(Boolean);
  const line = [
    `Last season: ${name(bossName)} led.`,
    made.length ? `${made.join(', ')}.` : 'No board was made, merged or closed.',
    facts.beats.length ? `${n(facts.beats.length, 'beat')} played.` : '',
    facts.busiest[0] ? `${name(facts.busiest[0].name)} was the busiest board.` : '',
  ].filter(Boolean).join(' ');
  return line.length > RECAP_MOST ? cutAtSentence(line, RECAP_MOST) : line;
}

/**
 * The push line of a beat the sitting Boss plays, by the key an initiative is stored under (the beat's event key): a plain key of its own arc or mini-arcs, or `after:<predecessor>:<key>` for an aftermath
 * beat, found only in that named predecessor's file, so two predecessors that share a beat key never give each other's push. The push lives in the persona file's `announce` block, so the Boss's pool calls read it here.
 */
export function pushOf(persona: Pick<Persona, 'arc' | 'miniArcs'>, roster: readonly AftermathFile[] = []): (beat: string) => string | undefined {
  return (beat) => leadInBeat(persona, beat, roster)?.announce?.push;
}

/**
 * The plot so far (sections 5, 8 and 8a), as plain lines: last season's recap (the code's fallback where the last meeting wrote none) and each announced initiative's title, pitch and thread; for the
 * sitting Boss also each initiative's push, where `push` finds one; a persona that was last season's Boss reads it in the second person, and one that announced an initiative while no longer
 * the Boss reads "You announced this", with no push. Nothing where there is neither. `reader.boss` is whether the persona reading holds the Boss's chair now.
 */
export function plotText(plot: PlotRead | undefined, reader: { readonly key: string; readonly boss: boolean }, titleMax: number, push?: (beat: string) => string | undefined): string[] {
  const all = plot?.initiatives ?? [];
  if (!plot || (!plot.last && all.length === 0)) return [];
  const lines = ['The plot so far. Everyone on staff has read it; it is public.'];
  if (plot.last) {
    const recap = (plot.last.recap !== null && plot.last.recap.trim() !== '' ? oneLine(plot.last.recap) : plot.last.facts ? recapFallback(plot.last.facts, plot.last.name) : '').slice(0, RECAP_MOST);
    if (plot.last.boss === reader.key) lines.push(recap ? `Last season you were the Boss. This is how you summed it up: ${recap}` : 'Last season you were the Boss.');
    else lines.push(recap ? `Last season ${oneLine(plot.last.name)} was the Boss. This is how they summed it up: ${recap}` : `Last season ${oneLine(plot.last.name)} was the Boss.`);
  }
  if (all.length) {
    lines.push('Initiatives announced this season:');
    const earlier = Math.max(0, all.length - PLOT_INITIATIVES_MOST);
    if (earlier) lines.push(`(and ${earlier} earlier)`);
    for (const i of all.slice(earlier)) {
      const mine = i.boss === reader.key;
      const pushed = reader.boss && mine ? push?.(i.beat) : undefined;
      const fit = (text: string, most: number): string => { const t = oneLine(text); return t.length > most ? cutAtSentence(t, most) : t; };
      lines.push(`- "${fit(i.title, titleMax)}" (thread ${i.thread}): ${fit(i.pitch, PITCH_MOST)}${mine && !reader.boss ? ' You announced this.' : ''}${pushed ? ` Your push: ${oneLine(pushed)}` : ''}`);
    }
  }
  return [lines.join('\n')];
}

/* ------------------------------------------------------------------------------------ order ---- */

/** The roles a part's params name from its own bundle (a `{role}` with no beat). */
export function ownRoles(params: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const name of BOARD_PARAMS) {
    const v = record(params[name]);
    if (typeof v['role'] === 'string' && v['beat'] === undefined) out.push(v['role']);
  }
  return out;
}

/**
 * The order to queue parts in: a part after every part whose role it names, the rest as they came. A part that names a role no part makes (or a cycle) is put last, where the repair
 * drops it for the role it lacks. Returns the original indexes; `moved` says whether the order is not the one given.
 */
export function dependencyOrder(parts: readonly { readonly role: string | null; readonly makes: boolean; readonly needs: readonly string[] }[]): { readonly order: number[]; readonly moved: boolean } {
  const order: number[] = [];
  const left = parts.map((_, i) => i);
  const made = new Set<string>();
  while (left.length) {
    const at = left.findIndex((i) => parts[i]!.needs.every((r) => made.has(r)));
    if (at < 0) break;
    const [i] = left.splice(at, 1);
    order.push(i!);
    if (parts[i!]!.makes && parts[i!]!.role !== null) made.add(parts[i!]!.role!);
  }
  order.push(...left);
  return { order, moved: order.some((x, k) => x !== k) };
}

/* ------------------------------------------------------------------------------------- fill ---- */

export interface FillContext {
  /** Epoch milliseconds. */
  readonly now: number;
  readonly structuralHoldHours: number;
  /** `Settings.boardNameMaxLength`, and the instance's name style (problems found in a name; none: it is in the style). */
  readonly nameMax: number;
  readonly nameStyle: (name: string) => readonly string[];
  readonly limits: MachineLimits;
  /** The boards and threads the meeting was given, which a slot that names one is held to. */
  readonly boards: ReadonlySet<string>;
  readonly threads: ReadonlySet<string>;
}

export type Filled =
  | { readonly ok: true; readonly parts: readonly PlannedPart[]; readonly trims: readonly Trim[] }
  | { readonly ok: false; readonly path: string; readonly predicate: string; readonly trims: readonly Trim[] };

const BOARD_NAMED = new Set(['createBoard', 'renameBoard']);
const HOUR = 3_600_000;

/**
 * An authored bundle's parts from its template and the Boss's slots, at `at` (the answer's path for the beat, for the record). The writer's params are the writer's; a slot is the Boss's value
 * where it can be used and the template's default where it cannot. A part is queued at once (a structural one waits the admin hold), lasting, with no expiry and no demand: a part of any other
 * kind cannot be built from a template, and fails the whole bundle, naming it.
 */
export function fillBundle(template: BundleTemplate, slots: unknown, why: string, c: FillContext, at: string): Filled {
  const trims: Trim[] = [];
  const answered = record(slots);
  const roles = new Set(template.parts.map((p) => p.role));
  for (const [role, given] of Object.entries(answered)) {
    if (!roles.has(role) || Object.keys(template.parts.find((p) => p.role === role)?.slots ?? {}).length === 0) {
      trims.push({ path: `${at}.slots.${role}`, predicate: 'isSlot', before: 1, after: 0 });
      continue;
    }
    for (const name of Object.keys(record(given))) {
      if (!(name in (template.parts.find((p) => p.role === role)!.slots ?? {}))) trims.push({ path: `${at}.slots.${role}.${name}`, predicate: 'isSlot', before: 1, after: 0 });
    }
  }
  const parts: PlannedPart[] = [];
  for (const part of template.parts) {
    const kind = moveKind(part.kind);
    if (!kind || !kind.askable || !kind.offices.includes('boss') || !kind.lasting) return { ok: false, path: `${at}.parts.${part.role}.kind`, predicate: 'lastingKind', trims };
    const params: Record<string, unknown> = { ...part.params };
    const given = record(answered[part.role]);
    for (const [name, slot] of Object.entries(part.slots ?? {})) {
      const path = `${at}.slots.${part.role}.${name}`;
      const asked = given[name];
      let value: unknown = slot.default;
      if (asked !== undefined && asked !== null) {
        const usable = slotValue(asked, slot.default, kind.key, name, kind.params, c, path, trims);
        if (usable !== undefined) value = usable;
      }
      params[name] = value;
    }
    const checked = moveParamsProblems(kind.key, params, c.limits, true);
    if (!checked.ok) return { ok: false, path: `${at}.parts.${part.role}.${checked.path}`, predicate: checked.predicate, trims: [...trims, ...checked.trims.map((t) => ({ ...t, path: `${at}.parts.${part.role}.${t.path}` }))] };
    trims.push(...checked.trims.map((t) => ({ ...t, path: `${at}.parts.${part.role}.${t.path}` })));
    parts.push({
      role: part.role,
      kind: kind.key,
      params: checked.value as Record<string, unknown>,
      demand: null,
      goLiveAt: kind.structural ? c.now + c.structuralHoldHours * HOUR : c.now,
      expiresInHours: 0,
      why,
      structural: kind.structural,
    });
  }
  return { ok: true, parts, trims };
}

/**
 * One slot's value from what the Boss wrote, or undefined where it cannot be used and the default stands (recorded). A string over its kind's bound is trimmed and recorded; a board's name is
 * cut to `boardNameMaxLength` (recorded) and then must be in the name style, or the default stands, since a name is never corrected; a board or thread must be one the meeting was given.
 */
function slotValue(asked: unknown, fallback: unknown, kind: string, name: string, rule: Rule, c: FillContext, path: string, trims: Trim[]): unknown {
  const miss = (predicate: string): undefined => {
    trims.push({ path, predicate, before: 1, after: 0 });
    return undefined;
  };
  if (typeof fallback === 'number') {
    // A number is written as its digits where the schema asks for text: read as the number the slot wants, and recorded.
    if (typeof asked === 'string' && /^-?\d+(\.\d+)?$/.test(asked.trim())) {
      trims.push({ path, predicate: 'asNumber', before: asked.length, after: 1 });
      return Number(asked.trim());
    }
    return typeof asked === 'number' && Number.isFinite(asked) ? asked : miss('isNumber');
  }
  if (typeof asked !== 'string') return miss('isString');
  if (asked.trim() === '') return miss('nonEmpty');
  let value = asked;
  const field = rule.type === 'object' ? rule.fields[name] : undefined;
  if (field?.type === 'string') {
    const cut = repair(value, field);
    if (cut.ok) {
      trims.push(...cut.trims.map((t) => ({ ...t, path })));
      value = cut.value as string;
    }
  }
  if (BOARD_NAMED.has(kind) && name === 'name') {
    if (value.length > c.nameMax) {
      trims.push({ path, predicate: `atMost(${c.nameMax})`, before: value.length, after: c.nameMax });
      value = value.slice(0, c.nameMax);
    }
    if (c.nameStyle(value).length) return miss('nameStyle');
  }
  if (name === 'board' || name === 'into' || name === 'fallback') {
    if (!UUID.test(value) || !c.boards.has(value.toLowerCase())) return miss('isBoard');
    return value.toLowerCase();
  }
  if (name === 'thread') {
    if (!UUID.test(value) || !c.threads.has(value.toLowerCase())) return miss('isThread');
    return value.toLowerCase();
  }
  return value;
}

/** A role is a key; the guard holds the same. */
export const isRoleName = (v: unknown): v is string => typeof v === 'string' && ROLE.test(v);
