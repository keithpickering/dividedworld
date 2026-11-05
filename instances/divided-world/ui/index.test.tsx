import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { glassVars } from '../../../engine/ui/glass/apply.ts';
import { boardSwitch } from '../../../engine/ui/glass/board.ts';
import { SURFACES } from '../../../tools/check-glass-contrast.mjs';
import { guideFaults, readInstance } from '../../../tools/check-guide.mjs';
import { QUADRANTS } from '../../../engine/rules/types.ts';
import { instanceUiProblems } from '../../../engine/ui/tips/problems.ts';
import { TIP_KEYS } from '../../../engine/ui/tips/keys.ts';
import { instance } from '../index.ts';
import { logRows } from '../../../engine/ui/log/lines.ts';
import type { Act, Log } from '../../../engine/ui/data/api.ts';
import { instanceUi, REASON_KEYS, wordsRead } from './index.ts';

describe('Divided World\'s developer persona', () => {
  test('is Gabe, with his tagline, and his picture is one the UI has', () => {
    expect(instance.developer).toEqual({ name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' });
    expect(typeof instanceUi.avatars?.[instance.developer!.avatar!], 'the persona\'s avatar key names a picture').toBe('string');
    expect(instanceUi.avatars!.gabe, 'Gabe\'s face is the sprite\'s PNG').toMatch(/^(data:image\/png|.*gabe.*\.png)/u);
  });
});

describe('Divided World\'s onboarding words', () => {
  test('fill the engine\'s tips exactly, and the check is run against the real instance', () => {
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
    expect(Object.keys(instanceUi.onboarding.tips).sort()).toEqual([...TIP_KEYS].sort());
  });
  test('the front door passes the same check, in its own words', () => {
    expect(instanceUi.frontDoor.cast.map((c) => c.name)).toEqual(['Snuckles', 'Captain Wholesome', 'The Accountant', 'Mr. Roboto']);
    /* One of each class that posts, each through the postbit's real revealed line: the Lurker never posts, so it is absent by design. */
    expect(instanceUi.frontDoor.cast.map((c) => c.revealed?.class)).toEqual(['jabroni', 'face', 'technician', 'heel']);
    expect(instanceUi.frontDoor.posts).toHaveLength(5);
    expect(instanceUiProblems(instanceUi, instance).filter((p) => /front door/u.test(p))).toEqual([]);
  });
  test('the letter opens as Gabe\'s welcome does', () => {
    expect(instanceUi.onboarding.letter).toMatch(/^## After nine years of development/u);
  });
});

describe('Divided World\'s Vending Machine words', () => {
  test('the shop is named plainly, and the sign has the design\'s twelve names, in order, each within the check', () => {
    expect(instanceUi.copy.shopName).toBe('Vending Machine');
    expect(instanceUi.copy.marquees).toHaveLength(12);
    expect(instanceUi.copy.marquees![0]).toBe('[MACHINE NAME]');
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
  });
});

describe('Divided World\'s Strategy Guide', () => {
  test('is the guide folder\'s Markdown and hints, and the check holds them to the instance', async () => {
    expect(instanceUi.guide.markdown).toMatch(/^<!--[\s\S]*?-->\s*## Welcome letter\s+<!-- kayfabb:letter -->/u);
    expect(Object.keys(instanceUi.guide.hints).sort()).toEqual(instance.classes.map((c) => c.key).sort());
    const real = await readInstance('divided-world');
    expect(guideFaults(real)).toEqual([]);
  });
});

describe('Divided World\'s InstanceUi covers its rules', () => {
  test('every class has a look and a description', () => {
    for (const c of instance.classes) {
      expect(instanceUi.classLooks[c.key], c.key).toBeDefined();
      expect(instanceUi.classLooks[c.key]?.description(instance.settings.economy, instance.settings.settlementLength).length, c.key).toBeGreaterThan(0);
    }
  });

  /* A class's words state the numbers in force (the core loop design, section 6, #57): each description and each reason names the
     economy keys it states (`wordsRead`), and says the number an admin has tuned, never the default. */
  const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
    'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const spelled = (n: number) => (n >= 1 && n <= 20 ? NUMBER_WORDS[n - 1]! : String(n));
  const holdsNumber = (text: string) => /\d/u.test(text) || new RegExp(`\\b(${NUMBER_WORDS.join('|')})\\b`, 'iu').test(text);
  const said = (key: string, economy: Readonly<Record<string, number>>) =>
    (instanceUi.classLooks[key] ? instanceUi.classLooks[key]!.description(economy, instance.settings.settlementLength) : instanceUi.reasonWords(key, economy));
  const economy = instance.settings.economy;
  test('each class\'s words say the numbers in force: shifted by 17, the shifted number is said and the default is not', () => {
    expect(Object.keys(wordsRead).length).toBeGreaterThan(0);
    for (const [key, reads] of Object.entries(wordsRead)) {
      const shifted = { ...economy, ...Object.fromEntries(reads.map((r) => [r, economy[r]! + 17])) };
      const text = said(key, shifted);
      for (const r of reads) {
        expect(text, `${key} says ${r} as tuned`).toMatch(new RegExp(`\\b${spelled(economy[r]! + 17)}\\b`, 'u'));
        expect(text, `${key} never says ${r}'s default`).not.toMatch(new RegExp(`\\b${spelled(economy[r]!)}\\b`, 'u'));
      }
    }
  });
  test('the numbers a reason\'s earnings carry are the ones its words declare, so a settled line is said with its own', () => {
    const lurker = instance.classes.find((c) => c.key === 'lurker')!;
    const earned = lurker.earn({
      character: 'lu', from: 0, to: 1, posts: [1, 2, 3, 4, 5].map((n) => ({ act: `p${n}`, at: n })), received: [], given: [], held: [], cardsPlayed: [], cardsLanded: [],
      threadsSpun: [{ act: 's1', thread: 't', at: 1, fromOthers: true, repliersBefore: 0, repliersNow: economy['lurker.spunThreadRepliers']! }],
    }, instance.settings);
    const reasons = Object.keys(wordsRead).filter((k) => k.includes('.'));
    for (const reason of reasons) {
      const carried = earned.filter((e) => e.reason === reason);
      expect(carried.length, `${reason} is earned here`).toBeGreaterThan(0);
      for (const e of carried) expect(Object.keys(e.params ?? {}).sort(), reason).toEqual([...wordsRead[reason]!].sort());
    }
  });
  test('every class description and reason that states a number names the economy keys it states', () => {
    for (const key of [...instance.classes.map((c) => c.key), ...REASON_KEYS]) {
      if (holdsNumber(said(key, economy))) expect(wordsRead[key]?.length ?? 0, `${key}: "${said(key, economy)}"`).toBeGreaterThan(0);
    }
  });
  test('every card has a face and rules in plain words, true to the settings it is told', () => {
    expect(instanceUi.cards.map((c) => c.key).sort()).toEqual(instance.cards.map((c) => c.key).sort());
    for (const c of instance.cards) {
      const ui = instanceUi.cards.find((u) => u.key === c.key)!;
      expect(ui.art.color, c.key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(ui.art.ink, c.key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(ui.describe(instance.settings).length, c.key).toBeGreaterThan(40);
    }
    const whoops = instanceUi.cards.find((c) => c.key === 'whoops')!;
    expect(whoops.describe(instance.settings)).toContain('1.00');
    expect(whoops.describe({ ...instance.settings, economy: { ...instance.settings.economy, 'whoops.price': 250 } })).toContain('2.50');
  });
  test('Whoops! draws its effect and its ink form, and each play\'s tag takes its own ink', () => {
    const whoops = instanceUi.cards.find((c) => c.key === 'whoops')!;
    expect(whoops.Effect).toBeDefined();
    expect(whoops.ConfigForm).toBeDefined();
    const play = (id: string, color: unknown) => ({ id, card: 'whoops', layer: 1, caster: null, message: '', config: { color }, playedAt: '', post: 'p' });
    const under = play('a', '#ffd93d');
    const top = play('b', '#101010');
    /* The tag on top is the most drawn play, not always the top ink, so each play's tag and chip is in its own ink. */
    expect(whoops.tag!(under, [under, top])).toBe('#ffd93d');
    expect(whoops.tag!(top, [under, top])).toBe('#101010');
    expect(whoops.tag!(under, [under])).toBe('#ffd93d');
    expect(whoops.tag!(play('c', 'not a color'), [play('c', 'not a color')])).toBeUndefined();
    expect(instanceUi.cards.find((c) => c.key === 'stick-around')!.tag).toBeUndefined();
  });
  test('both cards have their own mark icon, apart from the face, and Whoops! hints at the gesture', () => {
    for (const key of ['whoops', 'stick-around']) {
      const art = instanceUi.cards.find((c) => c.key === key)!.art;
      expect(art.mark, key).toBeTruthy();
    }
    /* Stick Around's mark is a bolder drawing than its face, for a 22px icon; Whoops!'s face is already one blot, so its mark is the same drawing. */
    const stick = instanceUi.cards.find((c) => c.key === 'stick-around')!.art;
    expect(stick.mark).not.toBe(stick.image);
    expect(instanceUi.cards.find((c) => c.key === 'whoops')!.hint).toBe('Drag across the ink to scrub it off your screen.');
  });
  test('Autocorrect draws its strips and its form, says its rules from the settings, and its log says what a play covered and what was peeled', () => {
    const ac = instanceUi.cards.find((c) => c.key === 'autocorrect')!;
    expect(ac.Effect).toBeDefined();
    expect(ac.ConfigForm).toBeDefined();
    expect(ac.art.mark).toBeTruthy();
    expect(ac.hint).toBe('Drag a strip off to read what is under it.');
    const said = ac.describe(instance.settings);
    expect(said).toContain('A Pepperoni card');
    expect(said).toContain('1.00');
    expect(said).toContain('0.25 more for every 50 characters it covers');
    expect(ac.describe({ ...instance.settings, economy: { ...instance.settings.economy, 'autocorrect.volumeStep': 40 } })).toContain('every 40 characters');
    expect(ac.surcharge!(instance.settings)).toBe('Covers a lot, +0.25 per 50 characters covered');
    expect(ac.logPlay!({ phrase: 'Mario', replacement: 'Luigi' })).toBe('It covers “Mario” with “Luigi”.');
    expect(ac.logPlay!({})).toBeUndefined();
    expect(ac.logSave!({ peeled: [0, 2] })).toEqual({ what: 'Strips peeled', said: 'You peeled 2 of its strips.' });
    expect(ac.logSave!({ peeled: [0], clean: true })).toEqual({ what: 'Peeled clean', said: 'You peeled every strip it had then. An edit that brings the phrase back brings a strip with it.' });
    expect(ac.logSave!({ peeled: [] })).toBeUndefined();
  });
  test('Autocorrect peeled clean, then an edit: the saved line never says the post is uncovered (#171 F1)', () => {
    /* Strips follow the phrase, so an edit that brings it back brings a strip: "covers nothing now" would go untrue here. */
    const at = '2026-10-30T10:00:00.000Z';
    const act = (id: string, kind: Act['kind'], character: string, over: Partial<Act> = {}): Act =>
      ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
    const post = act('post1', 'post', 'me', { seq: 1, payload: { body: 'Mario wins.' }, currentPayload: { body: 'Mario wins again.' }, editedAt: '2026-10-31T10:00:00.000Z' });
    const play = act('k1', 'card', 'them', { targetActId: 'post1', payload: { card: 'autocorrect', config: { phrase: 'Mario', replacement: 'Luigi' } } });
    const edit = act('e1', 'edit', 'me', { targetActId: 'post1', createdAt: '2026-10-31T10:00:00.000Z', payload: { body: 'Mario wins again.' } });
    const log: Log = { settlements: [], wallet: [], cards: [], playsOnMine: [], saves: [{ play: 'k1', post: 'post1', savedAt: at }], setEnds: [], setPasses: [], caught: [], ended: [], before: null };
    const mine = [{ id: 'me', name: 'Pipewrench', class: 'heel', classSince: at, classDueAt: null, turnOpensAt: null, debutedAt: at, debutLoudness: 'announced' as const, retiredAt: null, pendingTurn: null, presenceHidden: false }];
    const rows = logRows({
      log, mine, estimate: null, standings: {}, season: null, turns: [], acts: new Map([post, play, edit].map((a) => [a.id, a])),
      names: new Map([['them', 'Spritey']]), titles: new Map(), states: new Map([['k1', { peeled: [0], clean: true }]]),
    }, { instance, ui: instanceUi, postsPerPage: 20, economy: {} }, 600, null);
    const saved = rows.find((r) => r.kind === 'saved')!;
    const said = saved.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
    expect(said).not.toMatch(/nothing now/u);
    expect(said).toContain('An edit that brings the phrase back brings a strip with it.');
  });
  test('the Lurker counts its posts per settlement window and says the span in force (#179)', () => {
    const lurker = instanceUi.classLooks.lurker!;
    const two = { ...economy, 'lurker.postsAllowed': 2 };
    expect(lurker.description(two, { unit: 'week', count: 1 })).toContain('posting more than twice in one settlement window (1 week).');
    expect(lurker.description(two, { unit: 'day', count: 1 })).toContain('posting more than twice in one settlement window (1 day).');
    expect(lurker.description(two, { unit: 'day', count: 1 })).not.toMatch(/a day/u);
    expect(instanceUi.reasonWords('lurker.postedTooMuch', two)).toBe('Posted too much: a post past two in one settlement window');
  });
  test('"Stole the thunder" names what it counted and when: votes, this window (#111)', () => {
    for (const reason of ['face.stoleThunder', 'heel.stoleThunder']) expect(instanceUi.reasonWords(reason, instance.settings.economy)).toContain('more votes than the post this window');
  });
  test('every pip style has images', () => {
    for (const p of instance.pipStyles) expect(instanceUi.pips[p.key], p.key).toBeDefined();
  });
  test('the house theme is first and holds both modes', () => {
    expect(instanceUi.themes[0]?.modes).toBe('both');
  });
  test('the glass is present: both keys, nine recipes and every surface the engine lists naming one', () => {
    const g = instanceUi.glass;
    expect(g).toBeDefined();
    expect(Object.keys(g.keys.standard).sort()).toEqual(Object.keys(g.keys.high).sort());
    expect(Object.keys(g.smoke.recipes)).toHaveLength(9);
    expect(Object.keys(g.smoke.surfaces)).toHaveLength(13);
    for (const [surface, recipe] of Object.entries(g.smoke.surfaces)) expect(g.smoke.recipes[recipe], surface).toBeDefined();
  });
  test('every class has marks, and their label is not empty', () => {
    for (const c of instance.classes) expect(instanceUi.classLooks[c.key]?.marks?.label.trim().length, c.key).toBeGreaterThan(0);
  });
  test('Calm wears the Technician, and the Lurker wears no quadrant', () => {
    expect(instanceUi.quadrantClasses?.calmPositive).toBe('technician');
    expect(Object.values(instanceUi.quadrantClasses ?? {})).not.toContain('lurker');
  });
  test('every class has a glass color', () => {
    for (const c of instance.classes) expect(instanceUi.glass.classes[c.key], c.key).toBeDefined();
  });
  test('every quadrant wears a class on the picker, a class of the rules with glass colors, each a different one', () => {
    const worn = QUADRANTS.map((q) => instanceUi.quadrantClasses?.[q]);
    for (const [i, key] of worn.entries()) {
      expect(instance.classes.map((c) => c.key), QUADRANTS[i]).toContain(key);
      expect(instanceUi.glass.classes[key!], QUADRANTS[i]).toBeDefined();
    }
    expect(new Set(worn).size).toBe(QUADRANTS.length);
  });
  test('every font file glass.json names exists, and the glass holds the URL it resolved to', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const named = JSON.parse(fs.readFileSync(path.join(dir, 'glass.json'), 'utf8')).fonts as { file: string }[];
    expect(named.length).toBeGreaterThan(0);
    expect(instanceUi.glass.fonts).toHaveLength(named.length);
    named.forEach((f, i) => {
      expect(fs.existsSync(path.join(dir, f.file)), f.file).toBe(true);
      const resolved = instanceUi.glass.fonts[i]!.file;
      expect(resolved, f.file).not.toBe(f.file);
      expect(resolved, f.file).toMatch(/\.woff2(\?.*)?$/);
    });
  });
  test('no font file sits in ui/fonts/ that glass.json does not name', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const named = new Set((JSON.parse(fs.readFileSync(path.join(dir, 'glass.json'), 'utf8')).fonts as { file: string }[]).map((f) => f.file));
    const shipped = fs.readdirSync(path.join(dir, 'fonts')).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`);
    expect(shipped.filter((f) => !named.has(f)), 'shipped but unnamed').toEqual([]);
  });
  test('the names tokens.css declares are the names the glass writes: two lists that must agree are one list', () => {
    const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../engine/ui/glass/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const declared = [...css.matchAll(/(--kb-glass-[\w-]+)\s*:/g)].map((m) => m[1]!).sort();
    /* The orbs' and the classes' properties are named by the instance's own orbs and class keys, so
       tokens.css cannot declare them; they are held to the instance's lists instead. */
    const keyed = /^--kb-glass-(orb|class)-/;
    const fromInstance = [
      ...instanceUi.glass.orbs.gradients.flatMap((_, i) => ['highlight', 'color', 'shade'].map((s) => `--kb-glass-orb-${i + 1}-${s}`)),
      ...(['core', 'edge'] as const).filter((e) => instanceUi.glass.orbs.body[e]).map((e) => `--kb-glass-orb-body-${e}`),
      ...Object.keys(instanceUi.glass.classes).flatMap((c) => ['fill', 'ink', 'large'].map((s) => `--kb-glass-class-${c}-${s}`)),
    ].sort();
    for (const key of ['standard', 'high'] as const) {
      const written = Object.keys(glassVars(instanceUi.glass, key)).sort();
      expect(written.filter((n) => !keyed.test(n)), `${key} key writes what tokens.css declares`).toEqual(declared);
      expect(written.filter((n) => keyed.test(n)), `${key} key writes each orb and class the instance gives`).toEqual(fromInstance);
    }
  });
  test('the surfaces the glass names are the surfaces the engine lists', () => {
    expect(Object.keys(instanceUi.glass.smoke.surfaces).sort()).toEqual([...SURFACES].sort());
  });
  test('the fonts ship with their license', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    expect(fs.readFileSync(path.join(dir, 'fonts', 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/);
  });
  test('every reason a class pays reads as a sentence of its own', () => {
    const reasons = ['face.cheered', 'face.liftedAPost', 'face.boredTheRoom', 'face.stoleThunder', 'heel.drewHeat', 'heel.stoleThunder', 'heel.shrugged',
      'jabroni.drewTheGroan', 'jabroni.soldTheL', 'jabroni.takenSincerely', 'lurker.calledIt', 'lurker.spunAThread', 'lurker.cardDrew', 'lurker.postedTooMuch',
      'technician.respected', 'technician.evergreen', 'technician.draggedIn'];
    for (const r of reasons) expect(instanceUi.reasonWords(r, instance.settings.economy), r).not.toMatch(/^Settled under/);
  });
  test('the Main board\'s layout becomes the Phone board\'s at 1152px: 1440 times the smallest phone size (16) over the smallest Main board size (20)', () => {
    expect(boardSwitch(instanceUi.glass)).toBe(1152);
  });
});
