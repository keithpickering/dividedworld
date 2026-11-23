/**
 * Cheap Shot, end to end on the fake with the real instance: the caster's next Move gets past a Force Field and a common Rope Break back, uses the card up,
 * and the page's pieces (the status, the ghost mark, the Lens line, the log line, the alert) say so from what is public or the caster's own.
 * The tests name no owner of the target: the pass is the same whoever set the ward.
 */
import { describe, expect, test } from 'vitest';
import type { Act, Refusal } from '../../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../../engine/ui/data/fake.ts';
import { waysOn } from '../../../../../engine/ui/cards/land.ts';
import { pierceWords } from '../../../../../engine/ui/cards/lens-words.ts';
import { playOf } from '../../../../../engine/ui/cards/plays.ts';
import { logRows, type LogData, type Words } from '../../../../../engine/ui/log/lines.ts';
import { instance } from '../../../index.ts';
import { instanceUi } from '../../index.ts';
import { cheapShot } from '../../../cards/cheap-shot.ts';

const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`refused: ${a.error}`);
  return a.value;
};

const rulesOf = (key: string) => { const c = instance.cards.find((x) => x.key === key); if (!c) throw new Error(`no card ${key}`); return c; };
const nameOf = (key: string) => rulesOf(key).name;

function setup() {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', instance.classes[0]!.key);
  const boFace = fake.seed.character(bo, 'Bo Face', instance.classes[0]!.key);
  const { thread, act: anas } = fake.seed.thread('general', anaFace, 'Hello', 'Ana here.');
  const fielded = fake.seed.post(thread, boFace, 'Bo, under a Force Field.');
  const roped = fake.seed.post(thread, boFace, 'Bo, with a Rope Break.');
  fake.seed.cards(ana, { 'cheap-shot': 3, whoops: 4 });
  fake.seed.cards(bo, { 'force-field': 1, 'rope-break': 1 });
  fake.signInAs(ana);
  const shot = async () => must(await fake.useCard('cheap-shot', anaFace, anaFace, {}, '', 'character', anas));
  return { fake, ana, bo, anaFace, boFace, anas, fielded, roped, shot };
}

const playsOn = async (fake: ReturnType<typeof setup>['fake'], post: string) => (await fake.postPlays([post])).plays.flatMap((a: Act) => playOf(a) ?? []);
const aboveAna = async (fake: ReturnType<typeof setup>['fake'], face: string, play: string) => (await fake.effectsAbove([face], null, null)).filter((e) => e.play === play);

describe('Cheap Shot gets the next Move past a ward and a catching back', () => {
  test('the pierce is up, then spent by the Move: status, ghost mark, Lens line, log line, then the alert and the unsprung back', async () => {
    const { fake, ana, bo, anaFace, boFace, fielded, roped, shot } = setup();

    // 1. The Cheap Shot is used on Ana's character; its status is the card's own and it is live above her posts.
    const first = await shot();
    expect(await aboveAna(fake, anaFace, first.id)).toHaveLength(1);
    expect(instanceUi.cards.find((c) => c.key === 'cheap-shot')?.status).toBe('Lining up a cheap shot');

    // 2. Bo puts a Force Field up; the ghost mark offers Whoops! there only with the pierce up, and the cast lands.
    fake.signInAs(bo);
    const ward = must(await fake.useCard('force-field', boFace, fielded, {}, ''));
    fake.signInAs(ana);
    const post = (await fake.actsById([fielded]))[0]!;
    const whoops = rulesOf('whoops');
    const now = fake.now();
    /* `landing` reads the real clock where the fake's is fixed in October, so the ward is held up past both, on the plays handed to `waysOn` only:
       the casts below go through the fake, on its own clock and the real Force Field. */
    const plays = (await playsOn(fake, fielded)).map((p) => ({ ...p, ends: '2999-01-01T00:00:00Z' }));
    if (cheapShot.gimmick?.kind !== 'pierce') throw new Error('Cheap Shot is a pierce');
    const upTo = cheapShot.gimmick.upTo;
    expect(plays.map((p) => p.id)).toContain(ward.id);
    expect(waysOn(whoops, post, plays, { postEffects: 8, cards: instance.cards, own: false, now }).cast).toBe(false);
    expect(waysOn(whoops, post, plays, { postEffects: 8, cards: instance.cards, own: false, now, pierce: upTo }).cast).toBe(true);
    const landed = must(await fake.playCard('whoops', anaFace, fielded, { color: 'red' }, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(landed.payload.pierce).toEqual({ by: first.id, card: 'cheap-shot', ward: 'force-field' });

    // The Lens row, from the public pierce alone, in the owner's words (its mount in the Lens is engine/ui/cards/lens.test.tsx's); and the status is gone.
    const p = landed.payload.pierce as { card: string; ward: string };
    expect(pierceWords(nameOf(p.card), nameOf(p.ward))).toBe('Played on a Cheap Shot, past Force Field');
    expect(await aboveAna(fake, anaFace, first.id)).toEqual([]);

    // A's log shows the Ward line.
    const page = await fake.logPage(null);
    const words: Words = { instance, ui: instanceUi, postsPerPage: 20, economy: {}, now: fake.now() };
    const data: LogData = { log: page.log, mine: await fake.myCharacters(), estimate: null, standings: page.standings, season: page.season, turns: [], nextSettlement: null, acts: new Map(page.acts.map((a) => [a.id, a])), names: new Map(page.people.map((c) => [c.id, c.name])), titles: new Map(), states: new Map() };
    const line = logRows(data, words, 600, null).filter((r) => r.kind === 'played').map((r) => r.details.join(''));
    expect(line.some((l) => l.includes(' Your Cheap Shot got it past a Force Field that would have turned it away.'))).toBe(true);

    // 3. Bo sets Rope Break on another post; a second Cheap Shot gets a Salty common past it: it lands, the back stays face down, only Ana is told.
    fake.signInAs(bo);
    const set = must(await fake.setCard('rope-break', boFace, roped, {}));
    fake.signInAs(ana);
    const second = await shot();
    const passed = must(await fake.playCard('whoops', anaFace, roped, { color: 'red' }, ''));
    expect(passed.payload.caught).toBeUndefined();
    expect(passed.payload.pierce).toEqual({ by: second.id, card: 'cheap-shot' });
    expect(await aboveAna(fake, anaFace, second.id)).toEqual([]);
    expect((await fake.postPlays([roped])).plays.some((a) => a.kind === 'spring')).toBe(false);
    expect((await fake.alerts()).filter((a) => a.kind === 'trapStruck')).toMatchObject([{ sub: 'passed', act: passed.id }]);
    fake.signInAs(bo);
    expect(await fake.myFaceDown([set.id])).toEqual({ [set.id]: 'rope-break' });
    expect((await fake.alerts()).filter((a) => a.kind === 'trapStruck')).toEqual([]);

    // 4. With no Cheap Shot left up, Force Field turns the cast away.
    fake.signInAs(ana);
    const again = await fake.playCard('whoops', anaFace, fielded, { color: 'red' }, '');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain('Force Field');
  });
});
