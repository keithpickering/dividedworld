/**
 * A small world on the in-memory backend, for `npm run dev:web` without a Supabase project and for
 * the end-to-end flows (playwright.config.ts builds with --mode e2e). Its names are made up for
 * the demo; nothing here is a real player or a real post.
 */
import type { Fake } from '../../engine/ui/data/fake.ts';

export interface Demo {
  readonly me: string;
  readonly other: string;
  readonly characters: { readonly pipewrench: string; readonly hooligan: string; readonly spritey: string };
  readonly thread: string;
}

export function seedDemo(fake: Fake): Demo {
  const day = 86_400_000;
  const t0 = Date.parse('2026-10-01T12:00:00Z');
  fake.seed.season({ number: 1, startsAt: '2026-10-01T00:00:00Z' });
  const me = fake.seed.account('demo-player');
  const other = fake.seed.account('demo-other');
  const pipewrench = fake.seed.character(me, 'Pipewrench', 'heel', { at: t0 });
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', 'face', { at: t0 + day });
  const spritey = fake.seed.character(other, 'Spritey', 'jabroni', { at: t0 + 2 * day });
  const { thread, act } = fake.seed.thread('general', spritey, 'Who keeps reacting with tea?', 'Every post I make, a single [b]☕[/b]. Show yourself.', { at: t0 + 3 * day });
  fake.seed.post(thread, pipewrench, 'It was me. It is always me.', { at: t0 + 3 * day + 3_600_000 });
  fake.seed.post(thread, spritey, 'I knew it.', { at: t0 + 3 * day + 7_200_000 });
  fake.seed.react(other, spritey, fake.seed.post(thread, hooligan, 'Calm down, everyone.', { at: t0 + 4 * day }), 'tea');
  fake.seed.react(me, pipewrench, act, 'fire');
  fake.seed.thread('general', hooligan, 'Rate my avatar', 'Be honest.', { at: t0 + 5 * day });
  fake.seed.settle({ at: t0 + 6 * day, wallet: { [me]: 240 }, standings: { [pipewrench]: 140, [hooligan]: 60, [spritey]: 90 } });
  fake.seed.cards(me, { whoops: 2, 'stick-around': 1 });
  fake.seed.estimate(me, { entries: [{ character: pipewrench, reason: 'heel.drewHeat', amount: 85 }] });
  fake.seed.views(thread, 3);
  fake.signInAs(me);
  return { me, other, characters: { pipewrench, hooligan, spritey }, thread };
}
