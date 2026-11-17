import { expect, test, type Page } from '@playwright/test';
import { settled } from './settled.ts';

/**
 * The wait for a settled page (e2e/settled.ts), driven both ways on a page built in place: an entrance still playing on the document's
 * clock holds it, and an animation on a scroll's timeline does not, since it moves only while the page scrolls and is never an entrance
 * (the phone hand's card poses, engine/ui/cards/Hand.tsx `animatePoses`, are one per card for as long as the hand is open).
 */

/** Whether `settled` returns within `ms`. */
const settlesWithin = (page: Page, ms: number) => Promise.race([settled(page).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

const page = `<div id="row" style="display:flex;overflow-x:auto;width:200px"><div id="card" style="flex:none;width:100px;height:50px"></div>${'<div style="flex:none;width:100px"></div>'.repeat(5)}</div><div id="box" style="width:10px;height:10px"></div>`;

test('an entrance on the document\'s clock holds the wait until it ends', async ({ page: p }) => {
  await p.setContent(page);
  await p.evaluate(() => { document.getElementById('box')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60_000 }); });
  expect(await settlesWithin(p, 1500)).toBe(false);
});

test('an animation on a scroll\'s view timeline does not hold the wait', async ({ page: p }) => {
  await p.setContent(page);
  const running = await p.evaluate(() => {
    const card = document.getElementById('card')!;
    const Timeline = (globalThis as unknown as { ViewTimeline: new (o: { subject: Element; axis: string }) => AnimationTimeline }).ViewTimeline;
    const a = card.animate([{ rotate: '10deg' }, { rotate: '-10deg' }], { timeline: new Timeline({ subject: card, axis: 'inline' }), fill: 'both' });
    return a.playState;
  });
  expect(running, 'the scroll-driven animation is running, as the hand\'s poses are').toBe('running');
  expect(await settlesWithin(p, 5000)).toBe(true);
});
