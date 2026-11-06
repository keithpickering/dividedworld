/**
 * What an instance's UI must fill exactly, checked beside `instanceProblems` (engine/rules/instance.ts), which checks its
 * rules: `onboarding.tips` has every tip key the engine knows and none it does not, each with a title and a line, and the
 * welcome letter is text; `copy.marquees`, when given, is a non-empty list of names of 1 to 20 characters; the front door names only cast
 * members, reactions and ranks the instance has, and cards with a `CardUi`. Pure, so the self-test can plant each defect; the build runs it
 * against the real instance (instances/divided-world/ui/index.test.tsx).
 */
import type { Instance } from '../../rules/types.ts';
import type { InstanceUi } from '../types.ts';
import type { CardPlay, CardUi } from '../cards/types.ts';
import { TIP_KEYS } from './keys.ts';
import { wordsProblems } from '../cards/lens-words.ts';

/** The longest a marquee name may be: the sign's width at 390px. */
export const MARQUEE_MAX = 20;

export function instanceUiProblems(ui: Pick<InstanceUi, 'onboarding' | 'copy' | 'frontDoor' | 'cards' | 'classLooks'>, instance: Pick<Instance, 'reactions' | 'ranks' | 'classes' | 'cards' | 'settings'>): string[] {
  const out: string[] = [];
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
  const on = ui.onboarding;
  if (typeof on !== 'object' || on === null) return ['the instance UI has no onboarding'];
  const tips: Record<string, { title?: unknown; line?: unknown } | undefined> = on.tips ?? {};
  for (const key of TIP_KEYS) {
    const tip = tips[key];
    if (tip === undefined) out.push(`the onboarding has no tip "${key}"`);
    else {
      if (typeof tip.title !== 'string' || tip.title.trim() === '') out.push(`the tip "${key}" has no title`);
      if (typeof tip.line !== 'string' || tip.line.trim() === '') out.push(`the tip "${key}" has no line`);
    }
  }
  for (const key of Object.keys(tips)) if (!(TIP_KEYS as readonly string[]).includes(key)) out.push(`the onboarding has a tip "${key}", which is not one of the engine's tips`);
  if (typeof on.letter !== 'string' || on.letter.trim() === '') out.push('the onboarding has no letter');
  out.push(...frontDoorProblems(ui, instance));
  out.push(...classLookProblems(ui.classLooks, instance));
  /* The Lens's heading for a card with no live view: a short status, never a sentence (cards/lens-words.ts). */
  for (const card of ui.cards ?? []) {
    if (card.status === undefined) out.push(`the card "${card.key}" has no status, so its Lens heading would be a sentence`);
    else for (const words of statusWords(card.status, instance.cards?.find((c) => c.key === card.key)?.stack ?? 1)) out.push(...wordsProblems('status', words).map((p) => `the card "${card.key}": ${p}`));
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
  }
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
