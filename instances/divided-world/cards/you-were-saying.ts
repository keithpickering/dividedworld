/**
 * You Were Saying? (Pepperoni, common): the old voice finishes the post's sentence after the author stops, in a tail that types itself in
 * after the body (docs/plans/2026-11-07-you-were-saying-design.md). It is a cast Move that reaches a post alone, and the only card that
 * writes (`writes`): the engine owns the queue, the call, the scrubber and the refund; this file owns what a play buys and the page the
 * model continues (you-were-saying/frame.ts).
 *
 * - **Its length** is its configuration: `steps` from 0 to the most the economy allows, each adding `stepTokens` to `baseTokens`, and each
 *   costing `stepPrice` on top of the machine's price. A face with no configuration asks the most.
 * - **It lands** on a post with words of its own: one that is only a quote, code, a link or images has nothing to continue.
 * - **Its state** is the author's clear, the version of the post whose tail was erased by hand; it holds until the next edit makes a new one.
 * - **A Mod Bot** plays it at the base length.
 */
import { economyOf, landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { defaults } from '../settings.ts';
import { youWereSayingFrame } from './you-were-saying/frame.ts';

export type YouWereSayingConfig = { readonly steps: number };

/** The most steps the economy allows: the whole number of steps from the base length up to the most. */
export const mostSteps = (settings: Parameters<typeof economyOf>[0]): number => {
  const [base, step, most] = [economyOf(settings, 'youWereSaying.baseTokens'), economyOf(settings, 'youWereSaying.stepTokens'), economyOf(settings, 'youWereSaying.mostTokens')];
  return Math.max(0, Math.floor((most - base) / step));
};

export const youWereSaying: CardRules<YouWereSayingConfig> = {
  key: 'you-were-saying',
  name: 'You Were Saying?',
  alignment: 'pepperoni',
  rarity: 'common',
  stack: 3,
  reads: [
    { key: 'youWereSaying.baseTokens', whole: true, min: 1 },
    { key: 'youWereSaying.stepTokens', whole: true, min: 1 },
    { key: 'youWereSaying.stepPrice', whole: true, min: 0 },
    { key: 'youWereSaying.mostTokens', whole: true, min: 1 },
  ],
  writes: {
    tokens: (config, settings) => economyOf(settings, 'youWereSaying.baseTokens') + Math.min(config.steps, mostSteps(settings)) * economyOf(settings, 'youWereSaying.stepTokens'),
    frame: youWereSayingFrame,
  },
  playPrice: (settings, target, config) => {
    if (target.reach !== 'post') return 0;
    // A face asks the most a play could cost, before anyone has chosen a length (engine/ui/cards/faces.ts).
    const steps = typeof config?.steps === 'number' ? Math.min(config.steps, mostSteps(settings)) : mostSteps(settings);
    return Math.max(0, steps * economyOf(settings, 'youWereSaying.stepPrice'));
  },
  canApply: (target, effects, config, now) => {
    const lands = landsOn(youWereSaying, target, effects, now);
    if (!lands.ok || target.reach !== 'post') return lands;
    return target.text.trim() === '' ? refuse("There's nothing in this post to continue.") : lands;
  },
  staffConfigs: [{ steps: 0 }],
  validateConfig: (config) => {
    const { steps } = typeof config === 'object' && config !== null ? (config as { steps?: unknown }) : {};
    if (typeof steps !== 'number' || !Number.isSafeInteger(steps) || steps < 0) return refuse('the length is a whole number of steps, from 0 up');
    // validateConfig holds no settings, so the bound is the instance's own numbers; tokens and playPrice hold the live ones, so an override that lowers the most is never exceeded.
    if (steps > mostSteps(defaults)) return refuse(`the length is at most ${mostSteps(defaults)} steps`);
    return ok({ steps });
  },
  validateState: (state) => {
    const { cleared, ...rest } = typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as { cleared?: unknown }) : { cleared: undefined, bad: true };
    if (typeof cleared !== 'string' || cleared === '' || Object.keys(rest).length) return refuse('the state is the version that was cleared');
    return ok({ cleared });
  },
};
