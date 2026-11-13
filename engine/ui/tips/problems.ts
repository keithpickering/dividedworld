/**
 * What an instance's UI must fill exactly, checked beside `instanceProblems` (engine/rules/instance.ts), which checks its
 * rules: `onboarding.tips` has every tip key the engine knows and none it does not, each with a title and a line, and the
 * welcome letter is text; the code of conduct has a positive whole version and sections with unique keys, each with a title and text; `copy.marquees`, when given, is a non-empty list of names of 1 to 20 characters; `copy.badges`, when given, is a non-empty list of pairs of two words of 12 characters between them; the front door names only cast
 * members, reactions and ranks the instance has, and cards with a `CardUi`. Pure, so the self-test can plant each defect; the build runs it
 * against the real instance (instances/divided-world/ui/index.test.tsx).
 */
import type { Instance } from '../../rules/types.ts';
import { MAP, type ClassMarks, type InstanceUi } from '../types.ts';
import type { CardPlay, CardUi } from '../cards/types.ts';
import { QUADRANTS, type Quadrant } from '../../rules/types.ts';
import { ACTION_TIPS, TIP_KEYS } from './keys.ts';
import { wordsProblems } from '../cards/lens-words.ts';
import { CONDUCT_TEMPLATES, TEMPLATES } from '../../mail/conduct.ts';

/** The longest a marquee name may be: the sign's width at 390px. */
export const MARQUEE_MAX = 20;
/** The most characters a footer badge's two words hold between them: 80 pixels of the pixel face at 8px. */
export const BADGE_MAX = 12;
/** The most badges the footer shows: a row of them wraps (engine/ui/frame/frame.css), but a footer of a dozen is a wall. */
export const BADGES_MAX = 6;

export function instanceUiProblems(ui: Pick<InstanceUi, 'onboarding' | 'copy' | 'frontDoor' | 'cards' | 'classLooks' | 'conduct'> & Partial<Pick<InstanceUi, 'themes'>>, instance: Pick<Instance, 'reactions' | 'ranks' | 'classes' | 'cards' | 'settings'>): string[] {
  const out: string[] = [];
  /* A theme's `modes` and its preview's keys are one list (tools/theme-preview.mjs reads the keys from the theme's file). */
  for (const t of ui.themes ?? []) {
    const held = [t.preview?.light ? 'light' : '', t.preview?.dark ? 'dark' : ''].filter(Boolean);
    const want = t.modes === 'both' ? ['light', 'dark'] : [t.modes];
    if (held.join() !== want.join()) out.push(`the theme "${t.key}" says it holds ${want.join(' and ')}, and its file holds ${held.join(' and ') || 'no mode'}`);
  }
  for (const key of ['roleWord', 'staffWord', 'gameWord', 'staffBoardTag'] as const) {
    const word: unknown = ui.copy?.[key];
    if (typeof word !== 'string' || word.trim() === '') out.push(`the copy has no ${key}`);
  }
  const kinds: unknown = ui.copy?.cardKinds;
  if (kinds !== undefined) {
    for (const key of ['cast', 'set', 'use']) {
      const word: unknown = (kinds as Record<string, unknown> | null)?.[key];
      if (typeof word !== 'string' || word.trim() === '') out.push(`the copy's cardKinds has no ${key}`);
    }
  }
  const marquees: unknown = ui.copy?.marquees;
  if (marquees !== undefined) {
    if (!Array.isArray(marquees) || marquees.length === 0) out.push('the copy has a marquees list with nothing in it');
    else {
      marquees.forEach((m: unknown, i) => {
        if (typeof m !== 'string' || m.trim() === '') out.push(`the marquee ${i + 1} is empty`);
        else if (m.length > MARQUEE_MAX) out.push(`the marquee "${m}" is ${m.length} characters, over the ${MARQUEE_MAX} the sign holds`);
      });
    }
  }
  const badges: unknown = ui.copy?.badges;
  if (badges !== undefined) {
    if (!Array.isArray(badges) || badges.length === 0) out.push('the copy has a badges list with nothing in it');
    else {
      if (badges.length > BADGES_MAX) out.push(`the copy has ${badges.length} badges, over the ${BADGES_MAX} a footer row holds`);
      const seen = new Map<string, number>();
      badges.forEach((b: unknown, i) => {
        const pair = Array.isArray(b) && b.length === 2 && b.every((w: unknown) => typeof w === 'string' && w.trim() !== '') ? (b as [string, string]) : null;
        if (pair === null) out.push(`the badge ${i + 1} is not a pair of words`);
        else if (seen.has(`${pair[0]} ${pair[1]}`)) out.push(`the badge ${i + 1} repeats the badge ${seen.get(`${pair[0]} ${pair[1]}`)} ("${pair[0]} ${pair[1]}")`);
        else if (`${pair[0]} ${pair[1]}`.length > BADGE_MAX) out.push(`the badge "${pair[0]} ${pair[1]}" is ${`${pair[0]} ${pair[1]}`.length} characters, over the ${BADGE_MAX} an 80 by 15 badge holds`);
        if (pair !== null && !seen.has(`${pair[0]} ${pair[1]}`)) seen.set(`${pair[0]} ${pair[1]}`, i + 1);
      });
    }
  }
  out.push(...conductProblems(ui.conduct));
  const on = ui.onboarding;
  if (typeof on !== 'object' || on === null) return [...out, 'the instance UI has no onboarding'];
  const tips: Record<string, { title?: unknown; line?: unknown; action?: unknown } | undefined> = on.tips ?? {};
  for (const key of TIP_KEYS) {
    const tip = tips[key];
    if (tip === undefined) out.push(`the onboarding has no tip "${key}"`);
    else {
      if (typeof tip.title !== 'string' || tip.title.trim() === '') out.push(`the tip "${key}" has no title`);
      if (typeof tip.line !== 'string' || tip.line.trim() === '') out.push(`the tip "${key}" has no line`);
      if ((ACTION_TIPS as readonly string[]).includes(key) && (typeof tip.action !== 'string' || tip.action.trim() === '')) out.push(`the tip "${key}" has an action button and no action label`);
    }
  }
  for (const key of Object.keys(tips)) if (!(TIP_KEYS as readonly string[]).includes(key)) out.push(`the onboarding has a tip "${key}", which is not one of the engine's tips`);
  if (typeof on.letter !== 'string' || on.letter.trim() === '') out.push('the onboarding has no letter');
  out.push(...frontDoorProblems(ui, instance));
  out.push(...classLookProblems(ui.classLooks, instance));
  /* The Lens's heading for a card with no live view: a short status, never a sentence (cards/lens-words.ts). */
  for (const card of ui.cards ?? []) {
    out.push(...drawnByProblems(card, ui.cards ?? []));
    if (card.status === undefined) out.push(`the card "${card.key}" has no status, so its Lens heading would be a sentence`);
    else for (const words of statusWords(card.status, instance.cards?.find((c) => c.key === card.key)?.stack ?? 1)) out.push(...wordsProblems('status', words).map((p) => `the card "${card.key}": ${p}`));
  }
  return out;
}

/**
 * A card that is drawn by another (`CardUi.drawnBy`) hands its plays to that card's `Effect`, so it names a card that has one, draws none of its own, and the
 * card it names is not itself drawn by a third: three faults, each naming the card.
 */
function drawnByProblems(card: CardUi, cards: readonly CardUi[]): string[] {
  if (card.drawnBy === undefined) return [];
  const out: string[] = [];
  const who = `the card "${card.key}"`;
  if (card.Effect !== undefined) out.push(`${who} has both drawnBy and an Effect; a card is drawn by another or draws itself, never both`);
  const named = cards.find((c) => c.key === card.drawnBy);
  if (named === undefined) out.push(`${who} is drawnBy "${card.drawnBy}", which has no CardUi`);
  else if (named.drawnBy !== undefined) out.push(`${who} is drawnBy "${card.drawnBy}", which is itself drawn by "${named.drawnBy}"; a chain is refused`);
  else if (named.Effect === undefined) out.push(`${who} is drawnBy "${card.drawnBy}", which has no Effect to draw it`);
  return out;
}

/** The conduct mail override: known templates only, each with words that fill only that template's slots. */
function conductMailProblems(mail: unknown): string[] {
  if (typeof mail !== 'object' || mail === null || Array.isArray(mail)) return ['the conduct mail is not an object of templates'];
  const out: string[] = [];
  for (const [key, words] of Object.entries(mail)) {
    if (!(CONDUCT_TEMPLATES as readonly string[]).includes(key)) { out.push(`the conduct mail has a template "${key}", which is not one of the engine's (${CONDUCT_TEMPLATES.join(', ')})`); continue; }
    if (typeof words !== 'object' || words === null) { out.push(`the conduct mail "${key}" is not an object of words`); continue; }
    const w = words as Record<string, unknown>;
    for (const field of Object.keys(w)) if (!['subject', 'preheader', 'heading', 'paragraphs', 'note'].includes(field)) out.push(`the conduct mail "${key}" has a field "${field}", which is not subject, preheader, heading, paragraphs or note`);
    const texts: string[] = [];
    for (const field of ['subject', 'preheader', 'heading', 'note']) {
      if (w[field] === undefined) continue;
      if (typeof w[field] !== 'string') out.push(`the conduct mail "${key}" ${field} is not text`); else texts.push(w[field] as string);
    }
    if (w.paragraphs !== undefined) {
      if (!Array.isArray(w.paragraphs) || w.paragraphs.some((p) => typeof p !== 'string')) out.push(`the conduct mail "${key}" paragraphs are not a list of text`); else texts.push(...(w.paragraphs as string[]));
    }
    const slots = TEMPLATES[key as keyof typeof TEMPLATES].slots;
    for (const text of texts) for (const m of text.matchAll(/\{(\w+)\}/g)) if (!slots.includes(m[1] ?? '')) out.push(`the conduct mail "${key}" uses the slot {${m[1]}}, which that template does not have`);
  }
  return out;
}

/** The code of conduct: a positive whole version, sections with unique keys, and a title and words in each. */
function conductProblems(conduct: unknown): string[] {
  if (typeof conduct !== 'object' || conduct === null) return ['the instance UI has no conduct'];
  const { version, sections, mail } = conduct as { version?: unknown; sections?: unknown; mail?: unknown };
  const out: string[] = [];
  if (mail !== undefined) out.push(...conductMailProblems(mail));
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) out.push('the conduct version is not a positive whole number');
  if (!Array.isArray(sections) || sections.length === 0) return [...out, 'the conduct has no sections'];
  const seen = new Set<string>();
  for (const sec of sections as readonly ({ key?: unknown; title?: unknown; text?: unknown } | null)[]) {
    if (typeof sec !== 'object' || sec === null) { out.push('a conduct section is not a section'); continue; }
    const key = typeof sec.key === 'string' ? sec.key : '';
    if (key.trim() === '') out.push('a conduct section has no key');
    else if (!/^[A-Za-z][\w-]*$/u.test(key)) out.push(`the conduct section key "${key}" is not an id: a letter, then letters, digits, hyphens or underscores`);
    else if (seen.has(key)) out.push(`the conduct has two sections with the key "${key}"`);
    seen.add(key);
    if (typeof sec.title !== 'string' || sec.title.trim() === '') out.push(`the conduct section "${key}" has no title`);
    if (typeof sec.text !== 'string' || sec.text.trim() === '') out.push(`the conduct section "${key}" has no text`);
  }
  return out;
}

/**
 * Each class's look holds the class card to two facts: `description` says how it earns and `hurtsBy` what hurts it, which the card sets
 * apart in the hurt color. A class with no `hurtsBy`, or a description that still says "Hurt by" (the words not split), is named.
 */
function classLookProblems(looks: InstanceUi['classLooks'] | undefined, instance: Pick<Instance, 'classes' | 'settings'>): string[] {
  const out: string[] = [];
  const economy = instance.settings?.economy ?? {};
  const span = instance.settings?.settlementLength ?? { unit: 'day', count: 1 };
  for (const { key } of instance.classes) {
    const look = looks?.[key];
    if (look === undefined) { out.push(`the class "${key}" has no look, so its card has no earns and no hurtsBy`); continue; }
    if (typeof look.hurtsBy !== 'function') out.push(`the class "${key}" has no hurtsBy, so its card cannot set what hurts it apart`);
    else if (look.hurtsBy(economy, span).trim() === '') out.push(`the class "${key}" has a hurtsBy with no words in it`);
    if (/\bhurt by\b/iu.test(look.description(economy, span))) out.push(`the class "${key}" has a description that still says "Hurt by"; what hurts it belongs in hurtsBy`);
    out.push(...splitsProblems(key, look.marks));
  }
  return out;
}

/** A class's `splits` mark: two different quadrants of the map, side by side in one row, and in none of its other marks. */
function splitsProblems(key: string, marks: ClassMarks | undefined): string[] {
  const splits: unknown = marks?.splits;
  if (splits === undefined) return [];
  if (!Array.isArray(splits) || splits.length !== 2) return [`the class "${key}" has a splits that is not a pair of quadrants`];
  const [a, b] = splits as [Quadrant, Quadrant];
  const known = QUADRANTS as readonly string[];
  const unknown = (splits as string[]).filter((q) => !known.includes(q));
  if (unknown.length > 0) return unknown.map((q) => `the class "${key}" splits "${q}", which is not a quadrant`);
  if (a === b) return [`the class "${key}" splits ${a} with itself, and a split needs two quadrants`];
  const out: string[] = [];
  const [i, j] = [MAP.indexOf(a), MAP.indexOf(b)];
  if (Math.floor(i / 2) !== Math.floor(j / 2) || Math.abs(i - j) !== 1) out.push(`the class "${key}" splits ${a} and ${b}, which do not sit side by side in one row of the map`);
  for (const q of splits as Quadrant[]) for (const field of ['earns', 'hurts', 'calls'] as const) if (marks?.[field]?.includes(q)) out.push(`the class "${key}" splits ${q} and also ${field} it`);
  return out;
}

/** Every status a card can show: the one string, or a function's answer for 1 to the card's `stack` plays. */
function statusWords(status: NonNullable<CardUi['status']>, stack: number): string[] {
  if (typeof status === 'string') return [status];
  return Array.from({ length: stack }, (_, i) => status(Array.from({ length: i + 1 }, () => ({}) as CardPlay)));
}

/** The front door held to the instance: each problem names the post by its index. */
function frontDoorProblems(ui: Pick<InstanceUi, 'frontDoor' | 'cards'>, instance: Pick<Instance, 'reactions' | 'ranks' | 'classes'>): string[] {
  const door = ui.frontDoor;
  if (typeof door !== 'object' || door === null) return ['the instance UI has no front door'];
  const out: string[] = [];
  const keys = new Set<string>();
  for (const c of door.cast ?? []) {
    if (keys.has(c.key)) out.push(`front door cast key "${c.key}" is used twice`);
    keys.add(c.key);
    if (!Number.isInteger(c.rank) || c.rank < 0 || c.rank >= instance.ranks.length) out.push(`front door character "${c.key}" has rank ${c.rank}, which is not one of the instance's ${instance.ranks.length} ranks`);
    if (c.revealed !== undefined) {
      if (!instance.classes.some((k) => k.key === c.revealed!.class)) out.push(`front door character "${c.key}" is revealed as "${c.revealed.class}", which is not one of the instance's classes`);
      if (Number.isNaN(Date.parse(c.revealed.at))) out.push(`front door character "${c.key}" is revealed on "${c.revealed.at}", which is not a date`);
    }
  }
  const reactions = new Set(instance.reactions.map((r) => r.key));
  const cards = new Set(ui.cards.map((c) => c.key));
  if (!door.posts?.length) out.push('the front door has no posts');
  (door.posts ?? []).forEach((post, i) => {
    if (!keys.has(post.by)) out.push(`front door post ${i} is by "${post.by}", who is not in the cast`);
    for (const key of Object.keys(post.reactions ?? {})) if (!reactions.has(key)) out.push(`front door post ${i} has a reaction "${key}", which the instance does not have`);
    for (const play of post.plays ?? []) {
      if (!keys.has(play.by)) out.push(`front door post ${i} has a play by "${play.by}", who is not in the cast`);
      if (!cards.has(play.card)) out.push(`front door post ${i} plays "${play.card}", which has no CardUi`);
    }
  });
  return out;
}
