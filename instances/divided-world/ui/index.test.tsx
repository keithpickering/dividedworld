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
import { faceOf, facesOf } from '../../../engine/ui/cards/faces.ts';
import { landingOn } from '../../../engine/ui/cards/land.ts';
import { nameLines } from '../../../engine/ui/cards/nameLines.ts';
import { SIZES } from '../../../engine/ui/cards/template.ts';
import { logRows } from '../../../engine/ui/log/lines.ts';
import type { Act, Log } from '../../../engine/ui/data/api.ts';
import { instanceUi, REASON_KEYS, wordsRead } from './index.ts';
import { spanWords } from './cards.ts';
import { webpSize } from '../../../engine/ui/profile-edit/webp.ts';
import { gearUi } from './cosmetics.ts';
import { mooch } from '../cards/mooch.ts';
import { toll } from '../cards/toll.ts';
import { lineCutter } from '../cards/line-cutter.ts';
import { feelinGlam } from '../cards/feelin-glam.ts';
import { feelinFab } from '../cards/feelin-fab.ts';
import { fourDChess } from '../cards/4d-chess.ts';
import { offDay } from '../cards/off-day.ts';
import { CUES, laughTrack } from '../cards/laugh-track.ts';
import { LOG_DRAW, LOG_WASH, describeDraw } from '../cards/graffiti/words.ts';
import { wordsProblems } from '../../../engine/ui/cards/lens-words.ts';
import type { CardPlay } from '../../../engine/ui/cards/types.ts';
import { ENGINE_DEFAULT_PRONOUNS, PRONOUN_PRESETS } from '../../../engine/rules/pronouns.ts';

describe('Divided World\'s developer persona', () => {
  test('is Gabe, with his tagline, and his picture is one the UI has', () => {
    expect(instance.developer).toEqual({ name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe', pronouns: PRONOUN_PRESETS.he });
    expect(typeof instanceUi.avatars?.[instance.developer!.avatar!], 'the persona\'s avatar key names a picture').toBe('string');
    expect(instanceUi.avatars!.gabe, 'Gabe\'s face is the sprite\'s PNG').toMatch(/^(data:image\/png|.*gabe.*\.png)/u);
  });
});

describe('Divided World\'s code of conduct', () => {
  test('is version 1 with the design\'s seven sections, and passes the engine\'s check', () => {
    expect(instanceUi.conduct.version).toBe(1);
    expect(instanceUi.conduct.sections.map((s) => s.key)).toEqual(['person', 'hate', 'harassment', 'stop', 'onBoard', 'reportAbuse', 'outing']);
    expect(instanceUiProblems(instanceUi, instance).filter((p) => /conduct/u.test(p))).toEqual([]);
  });
});

describe('Divided World\'s onboarding words', () => {
  test('fill the engine\'s tips exactly, and the check is run against the real instance', () => {
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
    expect(Object.keys(instanceUi.onboarding.tips).sort()).toEqual([...TIP_KEYS].sort());
  });
  test('the front door passes the same check, in its own words', () => {
    expect(instanceUi.frontDoor.cast.map((c) => c.name)).toEqual(['Snuckles', 'Chadluminum', 'Serious Deer', 'Human Josh', 'D-Guy']);
    /* One of each class that posts, each through the postbit's real revealed line: the Lurker never posts, so it is absent by design. */
    expect(instanceUi.frontDoor.cast.map((c) => c.revealed?.class)).toEqual(['jabroni', 'face', 'technician', 'heel', 'tweener']);
    expect(instanceUi.frontDoor.posts).toHaveLength(6);
    /* A picture is a URL the bundler gave (a `?url` import), never a hand-typed path: a typed one 404s and the postbit shows a broken image. */
    for (const c of instanceUi.frontDoor.cast) {
      expect(c.avatarSquare, `${c.name}'s square`).toMatch(/\.(jpg|png)$|^data:image\//u);
      expect(c.avatarPortrait, `${c.name}'s portrait`).toMatch(/\.(jpg|png)$|^data:image\//u);
    }
    expect(instanceUiProblems(instanceUi, instance).filter((p) => /front door/u.test(p))).toEqual([]);
  });
  test('the letter opens as Gabe\'s welcome does', () => {
    expect(instanceUi.onboarding.letter).toMatch(/^## After nine years of development/u);
  });
});

describe('Divided World\'s gear and trophy art', () => {
  test('every gear has art and an aspect, and every trophy kind has a badge, and nothing else does', () => {
    expect(Object.keys(instanceUi.gear).sort()).toEqual(instance.gear.map((g) => g.key).sort());
    for (const g of instance.gear) {
      expect(instanceUi.gear[g.key]?.art, `${g.key}'s art`).toEqual(expect.any(String));
      expect(instanceUi.gear[g.key]!.aspect, `${g.key}'s aspect`).toBeGreaterThan(0);
    }
    expect(Object.keys(instanceUi.trophies).sort()).toEqual(instance.trophies.kinds.map((k) => k.key).sort());
    for (const k of instance.trophies.kinds) expect(instanceUi.trophies[k.key]?.art, `${k.key}'s badge`).toEqual(expect.any(String));
  });
});

describe('Divided World\'s Vending Machine words', () => {
  test('the shop is named plainly, and the sign has the design\'s twelve names, in order, each within the check', () => {
    expect(instanceUi.copy.shopName).toBe('Vending Machine');
    expect(instanceUi.copy.marquees).toHaveLength(22);
    expect(instanceUi.copy.marquees![0]).toBe('FRESH BEEF');
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

describe('Divided World\'s cards in the guide, in the glass\'s words about setting them face down', () => {
  const faces = facesOf(instance.cards, instanceUi.cards, instance.settings, instanceUi.copy.cardKinds);
  const face = (key: string) => faces.find((f) => f.key === key)!;
  const guideMd = instanceUi.guide.markdown;
  test('the card list holds Hall Pass, and the guide fills it', () => {
    expect(guideMd).toContain('<!-- kayfabb:cards -->');
    expect(faces.map((f) => f.key)).toContain('hall-pass');
  });
  test('Card Collector names the one card it catches, from the cards cast on a post at or below its rarity, and takes it; it pays nothing', () => {
    const t = face('card-collector');
    expect(t.describe).toMatch(/you take it into your hand/u);
    expect(t.summary).toMatch(/takes it into your hand/u);
    expect(t.describe).toMatch(/the one card it catches, from the cards cast on a post, uncommon or commoner/u);
    for (const text of [t.describe, t.summary]) expect(text).not.toMatch(/pays you|what it cost|wallet|what the caster paid/u);
  });
  test('each Move says what setting it does, landing at its own reach and no other', () => {
    const lands = { whoops: 'the quoting post', 'stick-around': 'the quoting post', autocorrect: 'the quoting post', 'feelin-fab': 'the quoting post', 'below-the-fold': 'the quoting post', 'laugh-track': 'the quoting post', 'glitter-bomb': "the quoting post's character", 'hype-up': "the quoting post's character", 'main-event': "the quoting post's thread", 'feelin-glam': "the quoting post's thread" };
    for (const [key, reach] of Object.entries(lands)) {
      expect(face(key).describe, key).toContain(`You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on ${reach} at no further cost, using up the card.`);
    }
    expect(face('autocorrect').describe).toMatch(/set one lands only when the quote's own words hold its phrase/u);
  });
  test('Line Cutter holds no face-down sentence, and every word of its face is the plan\'s, true to its rules', () => {
    const t = face('line-cutter');
    const ui = instanceUi.cards.find((c) => c.key === 'line-cutter')!;
    expect(ui.Effect).toBeUndefined();
    expect(ui.art.tagline).toBe('Reply right under a post.');
    expect([ui.art.color, ui.art.ink]).toEqual(['#d24a2c', '#1a0602']);
    expect(t.summary).toBe('Posts your reply right under a post, where it stays however long the thread grows.');
    expect(ui.status).toBe('A reply cut in under it');
    expect(ui.hint).toBe('A Line Cutter: the reply under this post was written later and cut in line.');
    expect(ui.logPlay?.({}, {})).toBe('It put a reply right under the post.');
    expect(t.describe).not.toMatch(/face down on one of your own posts/u);
    expect(t.describe).toMatch(/^A Pepperoni card, rare\. /u);
    expect(lineCutter.rarity).toBe('rare');
    expect(lineCutter.replies).toBe(true);
    expect(lineCutter.lasts).toBeUndefined();
    expect(t.describe).toContain('It is only ever cast face up.');
    expect(t.describe).toContain('One fits under a post, and a reply that cut in takes none under it.');
  });
  test("Feelin' Glam's words say its rarity, its span and Feelin' Fab's three, from the rules, and it draws through Feelin' Fab", () => {
    const t = face('feelin-glam');
    const ui = instanceUi.cards.find((c) => c.key === 'feelin-glam')!;
    expect(ui.drawnBy).toBe('feelin-fab');
    expect(ui.Effect).toBeUndefined();
    expect(ui.art.tagline).toBe('Give a whole thread a rainbow.');
    expect([ui.art.color, ui.art.ink]).toEqual(['#2ee6ff', '#03141a']);
    expect(feelinGlam.rarity).toBe('rare');
    expect(feelinGlam.lasts).toEqual({ unit: 'day', count: 7 });
    expect(feelinGlam.keeps).toBe(true);
    expect(feelinFab.stack).toBe(3);
    expect(t.summary).toBe("Cast on a thread. Every post there gets one more level of Feelin' Fab's rainbow for a week, and posts written in that time keep it.");
    expect(t.describe).toMatch(/^A Sweet card, rare, cast on a thread from its title\. For a week, every post in the thread is drawn with one more level of Feelin' Fab's rainbow, up to Feelin' Fab's three: /u);
    expect(t.describe).toContain("It takes none of a post's three Feelin' Fab places. A post written in the thread during that time keeps its extra level after it; every other post loses it when the time is up. If an admin ends the card, every post loses the level. One fits on a thread at a time.");
    expect(ui.hint).toBe("A Feelin' Glam: every post in this thread glows one level more.");
    expect(typeof ui.status === 'function' && [ui.status([{} as never]), ui.status([])]).toEqual(['One more rainbow level here', 'Kept by posts from its week']);
  });
  test('the guide names the three kinds and says every card back looks the same, with no payout from a trap', () => {
    expect(guideMd).toMatch(/- \*\*Move, Reversal, Gimmick\.\*\*/u);
    expect(guideMd).toMatch(/A Move is cast on a target, or set face down on your own post/u);
    expect(guideMd).toMatch(/A Reversal is only ever set face down on your own post/u);
    expect(guideMd).toMatch(/A Gimmick is played face up on your own post, your own character, or a thread your own character started/u);
    expect(guideMd).toMatch(/every card back looks the same/u);
    expect(guideMd).toMatch(/Sweet is babyface work, Salty is heel work/u);
    expect(guideMd).toMatch(/comes back to your hand/u);
    expect(guideMd).toMatch(/A Reversal takes no conditions/u);
    expect(guideMd).not.toMatch(/A Gimmick takes no conditions|\bWard\b/u);
    expect(guideMd).not.toMatch(/pays you|what it cost/u);
  });
});

describe('Divided World\'s Gimmick cards in plain words', () => {
  test('a span says "an hour", "a day", "a week", and counts the rest', () => {
    expect(spanWords({ unit: 'hour', count: 1 })).toBe('an hour');
    expect(spanWords({ unit: 'day', count: 1 })).toBe('a day');
    expect(spanWords({ unit: 'day', count: 7 })).toBe('a week');
    expect(spanWords({ unit: 'hour', count: 36 })).toBe('36 hours');
  });

  test('each new Gimmick reads its span and its amount from its own rules', () => {
    const faces = facesOf(instance.cards, instanceUi.cards, instance.settings, instanceUi.copy.cardKinds);
    const say = (key: string) => {
      const f = faces.find((x) => x.key === key)!;
      return `${f.describe} ${f.summary}`;
    };
    for (const key of ['publicity-tour', 'heat-magnet', 'hype-up']) expect(say(key), key).toMatch(/3 days[\s\S]*earns from[\s\S]*20% higher/u);
    expect(say('sugar-coat')).toMatch(/a week[\s\S]*Salty or Pepperoni/u);
    expect(say('last-word')).toMatch(/a week[\s\S]*refused before it is written/u);
    expect(say('class-clown')).toMatch(/3 days[\s\S]*earns from[\s\S]*is doubled/u);
    expect(say('class-clown')).not.toContain('100%');
    expect(say('good-vibes')).toMatch(/3 days[\s\S]*costs 0\.25 more/u);
  });
});

describe('Divided World\'s InstanceUi covers its rules', () => {
  /* The bundler resolves a small SVG to a data URI and a larger one to a file ending .svg; either is an SVG the card draws. */
  const SVG_URL = /\.svg$|^data:image\/svg\+xml/u;
  /* A card's canvas is its art.svg or its art.webp (specs/card-art.md); a WebP is never small enough to be inlined. */
  const CANVAS_URL = /\.svg$|^data:image\/svg\+xml|\.webp$/u;
  test('every card of the rules has art from its folder: a canvas that is an SVG or a WebP, a mark that is an SVG, and a credit', () => {
    expect(instance.cards.length).toBeGreaterThan(0);
    for (const rules of instance.cards) {
      const art = instanceUi.cards?.find((u) => u.key === rules.key)?.art;
      expect(art, `${rules.key} has a CardUi`).toBeDefined();
      expect(art!.canvas, `${rules.key} canvas`).toMatch(CANVAS_URL);
      expect(art!.mark, `${rules.key} mark`).toMatch(SVG_URL);
      expect(art!.credit.length, `${rules.key} credit`).toBeGreaterThan(0);
    }
  });

  test('the card back wears the instance\'s mark, an SVG', () => {
    expect(instanceUi.cardBack?.mark).toMatch(SVG_URL);
  });

  test('the card back has its picture from its folder, one for every card', () => {
    expect(instanceUi.cardBack?.canvas, 'the back').toMatch(CANVAS_URL);
    expect(Object.keys(instanceUi.cardBack ?? {}).sort()).toEqual(['canvas', 'mark']);
  });

  /* A card's name is laid out at no more than 165cqw over its longest line (engine/ui/cards/postcard.css), and a name of more than 14
     characters with a space breaks onto two lines at the slot and the phone (engine/ui/cards/nameLines.ts), each line on a taller plate that
     holds both. So the type a name gets is the smallest of its width bound and, for two lines, its plate's height bound. */
  const cardCss = fs.readFileSync(path.join(process.cwd(), 'engine/ui/cards/postcard.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const rule = (selector: string) => cardCss.split('}').map((r) => r.split('{')).find(([sel]) => sel?.trim() === selector)?.[1] ?? '';
  const nameFont = (size: string, lines: 1 | 2) => {
    const sel = lines === 2 ? `.kb-postcard[data-size='${size}'][data-lines='2'] .kb-postcard-name` : `.kb-postcard[data-size='${size}'] .kb-postcard-name`;
    const m = /font-size: max\(7px, min\(([\d.]+)cqw, calc\(([\d.]+)cqw/u.exec(rule(sel));
    expect(m, `the ${size}'s ${lines}-line name rule`).not.toBeNull();
    return { share: Number(m![1]), fit: Number(m![2]) };
  };
  const plateHeight = (size: string, lines: 1 | 2) => {
    const sel = lines === 2 ? `.kb-postcard[data-size='${size}'][data-lines='2'] .kb-postcard-plate` : `.kb-postcard[data-size='${size}'] .kb-postcard-plate`;
    const m = /height: ([\d.]+)cqw/u.exec(rule(sel));
    expect(m, `the ${size}'s ${lines}-line plate height`).not.toBeNull();
    return Number(m![1]);
  };
  const lineHeight = Number(/line-height: ([\d.]+)/u.exec(rule('.kb-postcard-name'))![1]);
  const padTop = Number(/padding: ([\d.]+)cqw/u.exec(rule('.kb-postcard-plate'))![1]);
  /** The px a name's type is at a size: its width bound over its longest line and, on two lines, the plate's height bound over two line-heights. */
  const nameSize = (name: string, size: 'slot' | 'phone') => {
    const { lines, longest } = nameLines(name);
    const { share, fit } = nameFont(size, lines.length === 2 ? 2 : 1);
    let cqw = Math.min(share, fit / longest);
    if (lines.length === 2) cqw = Math.min(cqw, (plateHeight(size, 2) - padTop) / (2 * lineHeight));
    return (cqw * SIZES[size]) / 100;
  };
  test('every card name stays legible at the slot and the phone', () => {
    for (const size of ['slot', 'phone'] as const) {
      for (const c of instance.cards) expect(nameSize(c.name, size), `${c.name} at the ${size}`).toBeGreaterThanOrEqual(10);
    }
  });
  test('a name that wraps does so on a plate tall enough for both lines, and a very long one would still fall short', () => {
    for (const size of ['slot', 'phone'] as const) {
      const { share } = nameFont(size, 2);
      expect(plateHeight(size, 2) - padTop, `the ${size}'s two lines at the largest size`).toBeGreaterThanOrEqual(2 * lineHeight * share);
      expect(nameSize('You Were Saying?', size)).toBeGreaterThanOrEqual(10);
      expect(nameSize('Wonderfully Extraordinarily Overlong Names', size), 'the guard goes red on a name too long even for two lines').toBeLessThan(10);
    }
  });

  test('every class has a look, a description and a hurtsBy', () => {
    for (const c of instance.classes) {
      expect(instanceUi.classLooks[c.key], c.key).toBeDefined();
      expect(instanceUi.classLooks[c.key]?.description(instance.settings.economy, instance.settings.settlementLength).length, c.key).toBeGreaterThan(0);
      expect(instanceUi.classLooks[c.key]?.hurtsBy(instance.settings.economy, instance.settings.settlementLength), c.key).toMatch(/^Hurt by /u);
    }
  });

  /* A class's words state the numbers in force (the core loop design, section 6, #57): each description and each reason names the
     economy keys it states (`wordsRead`), and says the number an admin has tuned, never the default. */
  const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
    'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const spelled = (n: number) => (n >= 1 && n <= 20 ? NUMBER_WORDS[n - 1]! : String(n));
  const holdsNumber = (text: string) => /\d/u.test(text) || new RegExp(`\\b(${NUMBER_WORDS.join('|')})\\b`, 'iu').test(text);
  const said = (key: string, economy: Readonly<Record<string, number>>) =>
    (instanceUi.classLooks[key]
      ? `${instanceUi.classLooks[key]!.description(economy, instance.settings.settlementLength)} ${instanceUi.classLooks[key]!.hurtsBy(economy, instance.settings.settlementLength)}`
      : instanceUi.reasonWords(key, economy));
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
      character: 'lu', from: 0, to: 1, posts: [1, 2, 3, 4, 5].map((n) => ({ act: `p${n}`, at: n })), received: [], given: [], held: [], cardsPlayed: [], cardsLanded: [], standings: [],
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
    expect(whoops.describe(instance.settings)).toContain('0.25 more for every 500 characters');
    expect(whoops.describe({ ...instance.settings, economy: { ...instance.settings.economy, 'whoops.perLength': 250 } })).toContain('2.50 more');
  });
  test('Laugh Track has its face, its machine slot and its rules in words true to the card and the settings', () => {
    const ui = instanceUi.cards.find((c) => c.key === 'laugh-track')!;
    expect(ui.art.color).toBe('#d24a2c');
    expect(ui.art.ink).toBe('#1a0602');
    expect(ui.art.tagline).toBe('Give a post a studio audience.');
    expect(ui.summary).toBe('Cues a studio audience to laugh, cheer or boo at the words you choose, wherever they appear in a post.');
    expect(ui.status).toBe('A studio audience on cue');
    expect(ui.hint).toBe('A Laugh Track: the audience stirs as you get close to certain words. Point at one, or tap it, to hear them react. Turn on Game sounds in Settings to hear it.');
    expect(ui.Effect).toBeDefined();
    expect(ui.ConfigForm).toBeDefined();
    expect(ui.logPlay!({}, {} as never)).toBe('It gave the post a studio audience.');
    const e = instance.settings.economy;
    const surcharge = ui.surcharge as (s: typeof instance.settings) => string;
    expect(surcharge(instance.settings)).toBe('Many places, +0.05 per place past 5');
    // Autocorrect's form: the amount is an orb amount (hundredths to two places), each value read with a fallback of 0.
    expect(surcharge({ ...instance.settings, economy: { ...instance.settings.economy, 'laughTrack.perPlace': 10 } })).toBe('Many places, +0.10 per place past 5');
    expect(surcharge({ ...instance.settings, economy: { ...instance.settings.economy, 'laughTrack.freePlaces': undefined as never } })).toBe('Many places, +0.05 per place past 0');
    const said = ui.describe(instance.settings);
    expect(said).toBe(`A Pepperoni card, ${laughTrack.rarity}. You choose up to five phrases in a post and give each a sound: the audience laughs, cheers or boos. Wherever a phrase appears in the post's own words, the audience stirs as a reader gets close and the phrase's underline fades in. Pointing at the phrase, tapping it, or pressing Enter on it plays the reaction. Every reaction is also shown as a caption, so it works with sound off. One audience fits on a post. You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on the quoting post at no further cost, using up the card. Set face down, it waits for a quote that says its first phrase. It costs more to play the more places its phrases cover.`);
    // True to the rules, each claim in the words tied to the rule that makes it so.
    const post = (text: string) => ({ reach: 'post', act: 'p1', kind: 'post', length: text.length, text } as never);
    const cueOf = (phrase: string, sound: string) => ({ phrase, sound });
    expect(CUES.most).toBe(5);
    expect(said).toContain('up to five phrases');
    const words = ['abcd', 'efgh', 'ijkl', 'mnop', 'qrst', 'uvwx'];
    expect(laughTrack.validateConfig!({ cues: words.slice(0, CUES.most).map((w) => cueOf(w, 'laugh')) }).ok).toBe(true);
    expect(laughTrack.validateConfig!({ cues: words.slice(0, CUES.most + 1).map((w) => cueOf(w, 'laugh')) }).ok).toBe(false);
    expect(said).toContain('laughs, cheers or boos');
    for (const sound of ['laugh', 'cheer', 'boo']) expect(laughTrack.validateConfig!({ cues: [cueOf('abcd', sound)] }).ok, sound).toBe(true);
    expect(laughTrack.validateConfig!({ cues: [cueOf('abcd', 'groan')] }).ok).toBe(false);
    expect(said).toContain('One audience fits on a post.');
    const config = { cues: [{ phrase: 'abcd', sound: 'laugh' as const }] };
    const audience = { card: 'laugh-track', act: 'a1' };
    expect(laughTrack.canApply(post('abcd'), [], config, new Date()).ok).toBe(true);
    expect(laughTrack.canApply(post('abcd'), [audience], config, new Date())).toEqual({ ok: false, why: 'this post already has an audience' });
    expect(said).toContain('It costs more to play the more places its phrases cover.');
    const free = e['laughTrack.freePlaces']!;
    const priceAt = (places: number) => laughTrack.playPrice!(instance.settings, post('abcd '.repeat(places)), config);
    expect(priceAt(free)).toBe(0);
    expect(priceAt(free + 1)).toBe(e['laughTrack.perPlace']);
    expect(priceAt(free + 2)).toBeGreaterThan(priceAt(free + 1));
    expect(priceAt(30)).toBe(e['laughTrack.mostAdded']);
    expect(laughTrack.rarity).toBe('uncommon');
    expect(laughTrack.alignment).toBe('pepperoni');
    expect(laughTrack.setPhrase!({ cues: [{ phrase: 'first one', sound: 'boo' }, { phrase: 'second', sound: 'cheer' }] })).toBe('first one');
    const at = instance.machine.findIndex((m) => 'card' in m.item && m.item.card === 'laugh-track');
    expect(instance.machine[at]).toEqual({ item: { card: 'laugh-track' }, availability: 'onSale', price: 150 });
    // Card notes Part 5 ended the on-sale run with Happy Heart and Take the Fall, after Laugh Track; nothing else on sale follows it.
    expect(instance.machine.slice(at + 1).filter((m) => m.availability === 'onSale').map((m) => ('card' in m.item ? m.item.card : 'pack'))).toEqual(['happy-heart', 'take-the-fall']);
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
    /* A Mod Bot's ink is a color's name; the tag gives the hex the splat draws, which the engine can read. */
    expect(whoops.tag!(play('d', 'teal'), [play('d', 'teal')])).toMatch(/^#[0-9a-f]{6}$/u);
    expect(instanceUi.cards.find((c) => c.key === 'stick-around')!.tag).toBeUndefined();
  });
  test('both cards have their own mark icon, apart from the face, and Whoops! hints at the gesture', () => {
    for (const key of ['whoops', 'stick-around']) {
      const art = instanceUi.cards.find((c) => c.key === key)!.art;
      expect(art.mark, key).toBeTruthy();
    }
    /* Stick Around's mark is a bolder drawing than its face, for a 22px icon; Whoops!'s face is already one blot, so its mark is the same drawing. */
    const stick = instanceUi.cards.find((c) => c.key === 'stick-around')!.art;
    expect(stick.mark).not.toBe(stick.canvas);
    expect(instanceUi.cards.find((c) => c.key === 'whoops')!.hint).toBe('Drag across the ink to scrub it off your screen.');
  });
  test('Jimmy Wails draws its drive, says its rules from the settings, and its log says whether a play opened the drive or joined it', () => {
    const jw = instanceUi.cards.find((c) => c.key === 'jimmy-wails')!;
    expect(jw.Effect).toBeDefined();
    expect(jw.summary).toBe('Puts your sob story on a donation banner under a post, so anyone can send its author Aura.');
    expect(jw.hint).toBe('Anyone can chip in. A cut of each gift goes to overhead.');
    expect(jw.hint).not.toMatch(/\d/u);
    const said = jw.describe(instance.settings);
    expect(said).toContain('0.10, 0.25, 0.50 and 1.00');
    expect(said).toContain('loses 25% to overhead');
    expect(said).toMatch(/Up to 3 appeals share one drive[\s\S]*a week after the latest one/u);
    const changed = { ...instance.settings, economy: { ...instance.settings.economy, 'jimmyWails.overhead': 10, 'jimmyWails.gift4': 200 } };
    expect(jw.describe(changed)).toMatch(/0\.10, 0\.25, 0\.50 and 2\.00[\s\S]*loses 10% to overhead/u);
    expect(jw.logPlay!({}, { opened: true })).toBe('It opened a drive.');
    expect(jw.logPlay!({}, { opened: false })).toBe('It joined the drive.');
    expect(jw.logPlay!({}, {})).toBeUndefined();
  });
  test('Autocorrect draws its strips and its form, says its rules from the settings, and its log says what a play covered and what was peeled', () => {
    const ac = instanceUi.cards.find((c) => c.key === 'autocorrect')!;
    expect(ac.Effect).toBeDefined();
    expect(ac.ConfigForm).toBeDefined();
    expect(ac.art.mark).toBeTruthy();
    expect(ac.hint).toBe('Lift a strip by one end to read what is under it.');
    const said = ac.describe(instance.settings);
    expect(said).toContain('A Pepperoni card');
    expect(said).toContain("Any reader can lift a strip by one end to read under it, and it lays back down. Only the post's author can peel strips off, slowly, for everyone, and the author's words are always under the tape and in the post's History.");
    expect(said).toContain('0.25 more for every 50 characters it covers');
    expect(ac.describe({ ...instance.settings, economy: { ...instance.settings.economy, 'autocorrect.volumeStep': 40 } })).toContain('every 40 characters');
    expect(ac.surcharge!(instance.settings)).toBe('Covers a lot, +0.25 per 50 characters covered');
    expect(ac.logPlay!({ phrase: 'Mario', replacement: 'Luigi' }, {})).toBe('It covers “Mario” with “Luigi”.');
    expect(ac.logPlay!({}, {})).toBeUndefined();
    expect(ac.logSave!({ peeled: [0, 2] })).toEqual({ what: 'Strips peeled', said: 'You peeled 2 of its strips.' });
    expect(ac.logSave!({ peeled: [0], clean: true })).toEqual({ what: 'Peeled clean', said: 'You peeled every strip it had then. An edit that brings the phrase back brings a strip with it.' });
    expect(ac.logSave!({ peeled: [] })).toBeUndefined();
    const one = [[0, 0.5, 0]];
    expect(ac.logSave!({ peeled: [0, 2], stuck: { '1': one, '3': one } })).toEqual({ what: 'Strips peeled', said: 'You peeled 2 of its strips, and started on 2 more.' });
    expect(ac.logSave!({ peeled: [0], stuck: { '1': one } })).toEqual({ what: 'Strips peeled', said: 'You peeled 1 of its strips, and started on 1 more.' });
    expect(ac.logSave!({ peeled: [], stuck: { '1': one } })).toEqual({ what: 'Strips peeled', said: 'You started peeling 1 of its strips.' });
    expect(ac.logSave!({ peeled: [], stuck: { '1': one, '2': one } })).toEqual({ what: 'Strips peeled', said: 'You started peeling 2 of its strips.' });
    expect(ac.logSave!({ peeled: [0, 2], stuck: {} })).toEqual({ what: 'Strips peeled', said: 'You peeled 2 of its strips.' });
    expect(ac.logSave!({ peeled: [], stuck: {} })).toBeUndefined();
  });
  /* The card that writes, in the log (the design's section 13): the caster's length, the author's clear, and what it did to the author's post. */
  test('You Were Saying? says the length its play recorded, the author\'s clear as theirs, and what it did in its own words', () => {
    const ywsCard = instanceUi.cards.find((c) => c.key === 'you-were-saying')!;
    /* The line is the recorded number, whatever the configuration or the economy now say; a play with no record says nothing of a length. */
    expect(ywsCard.logPlay!({ steps: 0 }, { tokens: 100 })).toBe('It was played for 100 tokens.');
    expect(ywsCard.logPlay!({ steps: 3 }, { tokens: 1 })).toBe('It was played for 1 token.');
    expect(ywsCard.logPlay!({ steps: 99 }, { tokens: 400 })).toBe('It was played for 400 tokens.');
    expect(ywsCard.logPlay!({ steps: 1 }, {})).toBeUndefined();
    expect(ywsCard.logSave!({ cleared: 'v1' })).toEqual({ what: 'Tail erased', verb: 'erased' });
    expect(ywsCard.logSave!({})).toBeUndefined();
    expect(ywsCard.logWritten!.continued).toBe('continued it');
    expect(ywsCard.logWritten!.again('You Were Saying?')).toBe('made its You Were Saying? again');
    expect(ywsCard.logWritten!.failed).toBe('didn\'t take');
  });
  test('the three lines of the author and the caster\'s length are said whole, from the instance\'s own words', () => {
    const at = '2026-11-09T10:00:00.000Z';
    const act = (id: string, kind: Act['kind'], character: string, over: Partial<Act> = {}): Act =>
      ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
    const post = act('post1', 'post', 'me', { seq: 1 });
    const play = act('k1', 'card', 'them', { targetActId: 'post1', payload: { card: 'you-were-saying', config: { steps: 3 }, tokens: 175 } });
    const log: Log = { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet: [], cards: [{ card: 'you-were-saying', kind: 'played', act: 'k1', price: 75, at }], packs: [], playsOnMine: [],
      writes: [{ play: 'k1', post: 'post1', version: 'post1', failed: false, opening: true, over: false, at }, { play: 'k1', post: 'post1', version: 'e1', failed: false, opening: false, over: false, at }, { play: 'k1', post: 'post1', version: 'e2', failed: true, opening: false, over: true, at }],
      saves: [{ play: 'k1', post: 'post1', savedAt: at }], setEnds: [], caught: [], ended: [], cosmetics: [], before: null };
    const mine = [{ id: 'me', name: 'Pipewrench', pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: at, classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: at, debutLoudness: 'announced' as const, retiredAt: null, pendingTurn: null, presenceHidden: false }, { ...{ id: 'them', name: 'Spritey' }, pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: at, classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: at, debutLoudness: 'announced' as const, retiredAt: null, pendingTurn: null, presenceHidden: false }];
    const rows = logRows({
      log, mine, estimate: null, standings: {}, season: null, turns: [], nextSettlement: null, acts: new Map([post, play].map((a) => [a.id, a])),
      names: new Map(), titles: new Map(), states: new Map([['k1', { cleared: 'post1' }]]),
    }, { instance, ui: instanceUi, postsPerPage: 20, economy: instance.settings.economy, now: Date.parse('2026-10-29T12:00:00.000Z') }, 600, 'me');
    const said = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join(''));
    expect(said('written').sort()).toEqual([
      'Your edit of post #1 made its You Were Saying? again.', 'You Were Saying? on your post #1 continued it.', 'You Were Saying? on post #1 didn\'t take.',
    ].sort());
    expect(said('saved')).toEqual(['You erased You Were Saying? on post #1.']);
  });
  test('Autocorrect peeled clean, then an edit: the saved line never says the post is uncovered (#171 F1)', () => {
    /* Strips follow the phrase, so an edit that brings it back brings a strip: "covers nothing now" would go untrue here. */
    const at = '2026-10-30T10:00:00.000Z';
    const act = (id: string, kind: Act['kind'], character: string, over: Partial<Act> = {}): Act =>
      ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
    const post = act('post1', 'post', 'me', { seq: 1, payload: { body: 'Mario wins.' }, currentPayload: { body: 'Mario wins again.' }, editedAt: '2026-10-31T10:00:00.000Z' });
    const play = act('k1', 'card', 'them', { targetActId: 'post1', payload: { card: 'autocorrect', config: { phrase: 'Mario', replacement: 'Luigi' } } });
    const edit = act('e1', 'edit', 'me', { targetActId: 'post1', createdAt: '2026-10-31T10:00:00.000Z', payload: { body: 'Mario wins again.' } });
    const log: Log = { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet: [], cards: [], packs: [], playsOnMine: [], writes: [], saves: [{ play: 'k1', post: 'post1', savedAt: at }], setEnds: [], caught: [], ended: [], cosmetics: [], before: null };
    const mine = [{ id: 'me', name: 'Pipewrench', pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: at, classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: at, debutLoudness: 'announced' as const, retiredAt: null, pendingTurn: null, presenceHidden: false }];
    const rows = logRows({
      log, mine, estimate: null, standings: {}, season: null, turns: [], nextSettlement: null, acts: new Map([post, play, edit].map((a) => [a.id, a])),
      names: new Map([['them', 'Spritey']]), titles: new Map(), states: new Map([['k1', { peeled: [0], clean: true }]]),
    }, { instance, ui: instanceUi, postsPerPage: 20, economy: {}, now: Date.parse('2026-10-29T12:00:00.000Z') }, 600, null);
    const saved = rows.find((r) => r.kind === 'saved')!;
    const said = saved.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
    expect(said).not.toMatch(/nothing now/u);
    expect(said).toContain('An edit that brings the phrase back brings a strip with it.');
  });
  test('the Lurker counts its posts per settlement window and says the span in force (#179)', () => {
    const lurker = instanceUi.classLooks.lurker!;
    const two = { ...economy, 'lurker.postsAllowed': 2 };
    expect(lurker.hurtsBy(two, { unit: 'week', count: 1 })).toContain('posting more than twice in one settlement window (1 week).');
    expect(lurker.hurtsBy(two, { unit: 'day', count: 1 })).toContain('posting more than twice in one settlement window (1 day).');
    expect(lurker.hurtsBy(two, { unit: 'day', count: 1 })).not.toMatch(/a day/u);
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
  test('the calm\'s feather is 60px, so the phone\'s is 30px (docs/plans/2026-11-05-backfill-boards-plan.md, Task 3)', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    expect((JSON.parse(fs.readFileSync(path.join(dir, 'glass.json'), 'utf8')) as { calm: { feather: number } }).calm.feather).toBe(60);
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
    const declared = [...css.matchAll(/(--kb-(?:glass|motion)-[\w-]+)\s*:/g)].map((m) => m[1]!).sort();
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
  test('a card\'s boost names the card it came from, by the key the settlement wrote, and says nothing of a card it cannot find', () => {
    expect(REASON_KEYS).toContain('card.boost');
    for (const card of instance.cards.filter((c) => c.gimmick?.kind === 'earn')) expect(instanceUi.reasonWords('card.boost', { card: card.key })).toBe(`${card.name} added: what the card's boost on a reaction earned`);
    expect(instanceUi.reasonWords('card.boost', {})).toMatch(/^A card added:/u);
    expect(instanceUi.reasonWords('card.boost', { card: 'gone' })).toMatch(/^A card added:/u);
  });
  test('the Main board\'s layout becomes the Phone board\'s at 1152px: 1440 times the smallest phone size (16) over the smallest Main board size (20)', () => {
    expect(boardSwitch(instanceUi.glass)).toBe(1152);
  });
});

describe('Divided World\'s kind words', () => {
  test('Whoops! is a Move, Hall Pass a Reversal, Force Field a Gimmick', () => {
    const kind = (key: string): string => faceOf(instance.cards.find((c) => c.key === key)!, instanceUi.cards.find((c) => c.key === key), instance.settings, instanceUi.copy.cardKinds).kind;
    expect([kind('whoops'), kind('hall-pass'), kind('force-field')]).toEqual(['Move', 'Reversal', 'Gimmick']);
  });
});

describe('a Booster in the log (the booster packs plan, Task 7)', () => {
  const at = '2026-11-07T10:00:00.000000+00:00';
  const contents = ['whoops', 'glitter-bomb', 'feelin-fab', 'stick-around', 'card-collector'];
  const pulled = contents.map((card) => ({ card, kind: 'pulled' as const, act: null, pack: 'pk1', price: 0, at }));
  const lines = (over: Partial<Log>, wallet: Log['wallet']) => logRows({
    log: { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet, cards: [], packs: [], playsOnMine: [], writes: [], saves: [], setEnds: [], caught: [], ended: [], cosmetics: [], before: null, ...over },
    mine: [], estimate: null, standings: {}, season: null, turns: [], nextSettlement: null, acts: new Map(), names: new Map(), titles: new Map(), states: new Map(),
  }, { instance, ui: instanceUi, postsPerPage: 20, economy: {}, now: Date.parse('2026-10-29T12:00:00.000Z') }, 600, null);
  const said = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const purchase = (price: number, balanceAfter: number): Log['wallet'][number] => ({ settlement: null, kind: 'purchase', change: -price, overflow: 0, floored: 0, balanceAfter, ref: null, at });

  test('five pulled rows and their purchase read as one line, in pull order, with the price and the wallet', () => {
    const rows = lines({ cards: pulled, packs: [{ pack: 'pk1', kind: 'booster', price: 300, repriced: false, contents, at }] }, [purchase(300, 1200)]);
    expect(rows.map((r) => r.kind)).toEqual(['pack']);
    expect(rows[0]!.what).toBe('You bought a Booster');
    expect(said(rows[0]!)).toBe('Whoops!, Glitter Bomb, Feelin\' Fab, Stick Around and Card Collector. From the Vending Machine, for 3.00.');
    expect([rows[0]!.aura, rows[0]!.wallet]).toEqual([-300, 1200]);
  });
  test('a purchase at a price the Boss moved says so, for a pack and for a card', () => {
    const pack = lines({ cards: pulled, packs: [{ pack: 'pk1', kind: 'booster', price: 450, repriced: true, contents, at }] }, [purchase(450, 1050)]);
    expect(said(pack[0]!)).toBe('Whoops!, Glitter Bomb, Feelin\' Fab, Stick Around and Card Collector. From the Vending Machine, for 4.50. The Boss had repriced it.');
    const card = lines({ cards: [{ card: 'whoops', kind: 'bought', act: null, price: 150, repriced: true, at }] }, [purchase(150, 100)]);
    expect(said(card[0]!)).toBe('From the Vending Machine, for 1.50. The Boss had repriced it.');
    const plainCard = lines({ cards: [{ card: 'whoops', kind: 'bought', act: null, price: 100, repriced: false, at }] }, []);
    expect(said(plainCard[0]!)).toBe('From the Vending Machine, for 1.00.');
  });
  test('two packs bought at one instant are two lines, each with its own cards', () => {
    const second = ['glitter-bomb', 'glitter-bomb', 'glitter-bomb', 'glitter-bomb', 'glitter-bomb'];
    const rows = lines({
      cards: [...pulled, ...second.map((card) => ({ card, kind: 'pulled' as const, act: null, pack: 'pk2', price: 0, at }))],
      packs: [{ pack: 'pk1', kind: 'booster', price: 300, repriced: false, contents, at }, { pack: 'pk2', kind: 'booster', price: 300, repriced: false, contents: second, at }],
    }, [purchase(300, 900), purchase(300, 600)]);
    expect(rows.map((r) => r.kind)).toEqual(['pack', 'pack']);
    expect(new Set(rows.map((r) => r.wallet))).toEqual(new Set([900, 600]));
    expect(rows.map(said).sort()[0]).toContain('Glitter Bomb, Glitter Bomb, Glitter Bomb, Glitter Bomb and Glitter Bomb');
  });
});

/* Staff pictures (the fangame split plan, Task 10): a persona's face is a file the bundler gave, held to the shapes the postbit and the profile draw. */
type Picture = { readonly kind: 'png' | 'webp'; readonly width: number; readonly height: number; readonly bytes: number };

/** A bundler URL or data URL as the file's bytes; a URL names a file by its basename in the given folder. */
function bytesOfUrl(url: string, folder: string): Uint8Array {
  if (url.startsWith('data:')) return Uint8Array.from(Buffer.from(url.slice(url.indexOf(',') + 1), url.includes(';base64') ? 'base64' : 'utf8'));
  return new Uint8Array(fs.readFileSync(path.join(folder, path.basename(url.split('?')[0]!))));
}

/** A PNG's or WebP's shape, or why it is neither. */
function pictureOf(bytes: Uint8Array): Picture | string {
  const view = Buffer.from(bytes);
  if (view.subarray(1, 4).toString('latin1') === 'PNG') return { kind: 'png', width: view.readUInt32BE(16), height: view.readUInt32BE(20), bytes: bytes.length };
  const size = webpSize(bytes);
  return size === null ? 'is neither a PNG nor a WebP' : { kind: 'webp', ...size, bytes: bytes.length };
}

/** What is wrong with a persona's pictures, as sentences. */
function staffPictureProblems(map: NonNullable<typeof instanceUi.staffAvatars>, personas: readonly string[], folder: string): string[] {
  const problems: string[] = [];
  for (const [key, faces] of Object.entries(map)) {
    if (!personas.includes(key)) problems.push(`${key} names no persona in the roster`);
    const square = pictureOf(bytesOfUrl(faces.square, folder));
    if (typeof square === 'string') problems.push(`${key}'s square ${square}`);
    else {
      if (square.width !== square.height) problems.push(`${key}'s square is ${square.width} by ${square.height}, not square`);
      if (square.width < 256) problems.push(`${key}'s square is ${square.width} wide, under 256`);
      if (square.bytes > 100 * 1024) problems.push(`${key}'s square is ${square.bytes} bytes, over 100 KB`);
    }
    if (faces.portrait === undefined) continue;
    const portrait = pictureOf(bytesOfUrl(faces.portrait, folder));
    if (typeof portrait === 'string') problems.push(`${key}'s portrait ${portrait}`);
    else {
      if (portrait.width < 256 || portrait.width > 512) problems.push(`${key}'s portrait is ${portrait.width} wide, outside 256 to 512`);
      if (portrait.height < portrait.width || portrait.height > 2 * portrait.width) problems.push(`${key}'s portrait is ${portrait.width} by ${portrait.height}, outside 1 to 2 times as tall as wide`);
      if (portrait.bytes > 400 * 1024) problems.push(`${key}'s portrait is ${portrait.bytes} bytes, over 400 KB`);
    }
  }
  return problems;
}

describe('Divided World\'s staff pictures', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const avatars = path.join(here, 'avatars');
  const fixtures = path.join(here, 'fixtures-staff-avatars');
  const roster = instance.system!.roster.map((p) => p.key);
  const fixtureUrl = (name: string) => `/fixtures/${name}`;

  test('every key names a persona in the roster, and every picture holds its shape', () => {
    expect(instanceUi.staffAvatars, 'the instance gives staff pictures').toBeDefined();
    expect(staffPictureProblems(instanceUi.staffAvatars!, roster, avatars)).toEqual([]);
  });
  test('a key that names nobody is red', () => {
    const problems = staffPictureProblems({ nobody: instanceUi.staffAvatars!['fangame']! }, roster, avatars);
    expect(problems).toEqual(['nobody names no persona in the roster']);
  });
  test('a 255-wide square is red', () => {
    const problems = staffPictureProblems({ fangame: { square: fixtureUrl('square-255.webp') } }, roster, fixtures);
    expect(problems).toEqual(expect.arrayContaining(['fangame\'s square is 255 wide, under 256']));
  });
  test('a 3:1 portrait is red', () => {
    const problems = staffPictureProblems({ fangame: { square: fixtureUrl('square-ok.png'), portrait: fixtureUrl('portrait-3to1.webp') } }, roster, fixtures);
    expect(problems).toEqual(['fangame\'s portrait is 300 by 900, outside 1 to 2 times as tall as wide']);
  });
  test('FanGaME has both pictures', () => {
    expect(instanceUi.staffAvatars?.['fangame']?.square).toMatch(/fangame-square.*\.webp|^data:image\/webp/u);
    expect(instanceUi.staffAvatars?.['fangame']?.portrait).toMatch(/fangame-portrait.*\.webp|^data:image\/webp/u);
  });
});

describe('Sugar Coat, Hype-Up and Last Word in plain words (card notes Part 4, Task 7)', () => {
  const ui = (key: string) => instanceUi.cards.find((c) => c.key === key)!;
  test('each wears its flavor\'s color with its ink, says what it does in a tagline and a summary, and keeps its status to six words', () => {
    for (const [key, color, ink, tagline] of [
      ['sugar-coat', '#2ee6ff', '#03141a', 'Only Sweet cards land on your post.'], ['hype-up', '#2ee6ff', '#03141a', 'Give a character a push.'],
      ['last-word', '#ff3d7f', '#14030a', 'Stop quotes of your post.'],
    ] as const) {
      expect([ui(key).art.color, ui(key).art.ink, ui(key).art.tagline], key).toEqual([color, ink, tagline]);
      expect(ui(key).art.canvas, key).toMatch(/\.webp$/u);
      expect(typeof ui(key).status === 'string' ? (ui(key).status as string).split(' ').length : 0, key).toBeLessThanOrEqual(6);
    }
    expect(ui('sugar-coat').summary).toBe('Used on your post. Turns away Salty and Pepperoni cards for a week.');
    expect(ui('hype-up').summary).toBe('Cast on a character. For 3 days, what it earns from positive reactions is 20% higher. A loss is never made worse.');
    expect(ui('last-word').summary).toBe('Used on your post. Nobody can quote it for a week.');
    const sugarWords = ui('sugar-coat').describe!({} as never);
    expect(sugarWords).toContain('It does not stop a card from being set face down there.');
    expect(sugarWords).not.toContain('It never stops a card set face down.');
    expect(ui('hype-up').logPlay!({}, {})).toBe('What that character earns from positive reactions is 20% higher until it ends.');
    expect(ui('last-word').logPlay!({}, {})).toBe('Nobody can quote that post until it ends.');
  });
});

describe('the Happy Hearts, Take the Fall and Tattle-Tale in plain words (card notes Part 5, Task 9)', () => {
  const KEYS = ['happy-heart', 'super-happy-heart', 'ultra-happy-heart', 'take-the-fall', 'tattle-tale'] as const;
  const ui = (key: string) => instanceUi.cards.find((c) => c.key === key);
  /* The rules are read from the instance, so a missing card fails on what it should say and not on an import. */
  const rules = (key: string) => instance.cards.find((c) => c.key === key) ?? ({ rarity: 'missing' } as never as (typeof instance.cards)[number]);
  const tattleTale = rules('tattle-tale');
  const faces = () => facesOf(instance.cards, instanceUi.cards, instance.settings, instanceUi.copy.cardKinds);
  /* A rule's number, retuned for one test and put back: the words are read from the rules and the settings, never restated. */
  const retuned = <T,>(rules: object, key: string, value: unknown, run: () => T): T => {
    const held = (rules as Record<string, unknown>)[key];
    (rules as Record<string, unknown>)[key] = value;
    try { return run(); } finally { (rules as Record<string, unknown>)[key] = held; }
  };
  const bands = (minor: number, moderate: number, severe: number) => ({ ...instance.settings, warnBar: { ...instance.settings.warnBar, bands: { minor, moderate, severe } } });
  const cap = (punishments: number, days: number) => ({ ...instance.settings, modBots: { ...instance.settings.modBots, cap: { punishments, days } } });

  test('each wears its flavor\'s color with its ink, a tagline, art that is a WebP and an SVG mark, and a hint', () => {
    expect(KEYS.map((k) => [k, ui(k)?.art.color, ui(k)?.art.ink, ui(k)?.art.tagline, ui(k)?.hint])).toEqual([
      ['happy-heart', '#2ee6ff', '#03141a', 'Take a notch off a warn bar.', "A Happy Heart took warn points off a character's bar."],
      ['super-happy-heart', '#2ee6ff', '#03141a', 'Empty a warn bar.', "A Super Happy Heart emptied a character's warn bar."],
      ['ultra-happy-heart', '#2ee6ff', '#03141a', 'End a ban on the spot.', "An Ultra Happy Heart ended a character's ban."],
      ['take-the-fall', '#2ee6ff', '#03141a', 'Take the blame for a post.', 'Someone has offered to take the fall for this post.'],
      ['tattle-tale', '#ff3d7f', '#14030a', 'Point the Mod Bots at someone.', "A Tattle-Tale: someone told the Mod Bots to watch this character."],
    ]);
    for (const k of KEYS) {
      expect(ui(k)?.art.canvas, k).toMatch(/\.webp$/u);
      expect(ui(k)?.art.mark, k).toMatch(/\.svg$|^data:image\/svg\+xml/u);
      expect(ui(k)?.art.credit?.length, k).toBeGreaterThan(0);
      expect(ui(k)?.Effect, `${k} draws nothing of its own`).toBeUndefined();
      expect(ui(k)?.ConfigForm, `${k} takes no configuration`).toBeUndefined();
    }
  });

  test('each says what it does in a summary and a status, both within the Lens\'s word rules', () => {
    expect(KEYS.map((k) => ui(k)?.summary)).toEqual([
      "Cast on a character. Takes the oldest points off that character's warn bar.",
      "Cast on a character. Empties that character's warn bar.",
      'Cast on a banned character. Ends the ban at once.',
      "Cast on another character's post. The next Mod Bot filing on it lands on your character instead.",
      "Cast on a character. Mod Bot patrols are twice as likely to look at that character's posts for a week.",
    ]);
    expect(['happy-heart', 'super-happy-heart', 'ultra-happy-heart', 'tattle-tale'].map((k) => ui(k)?.status)).toEqual(['Took points off a warn bar', 'Emptied a warn bar', 'Ended a ban', 'Told on to the Mod Bots']);
    const fall = ui('take-the-fall')?.status;
    expect(typeof fall === 'function' && [fall([{} as CardPlay]), fall([])]).toEqual(['Waiting to take the fall', 'Took the fall']);
    for (const k of KEYS) {
      const status = ui(k)!.status!;
      for (const words of typeof status === 'string' ? [status] : [status([{} as CardPlay]), status([])]) expect(wordsProblems('status', words), k).toEqual([]);
    }
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
  });

  test('"twice" is said only while the rules\' weight is 2', () => {
    expect(tattleTale.discipline).toEqual({ kind: 'watch', weight: 2 });
    expect(ui('tattle-tale')?.summary).toContain('twice as likely');
    expect(ui('tattle-tale')?.describe(instance.settings)).toContain("that character's posts are twice as likely to be picked");
    retuned(tattleTale, 'discipline', { kind: 'watch', weight: 3 }, () => {
      expect(ui('tattle-tale')?.describe(instance.settings)).toContain("that character's posts are 3 times as likely to be picked");
      expect(ui('tattle-tale')?.describe(instance.settings)).not.toContain('twice');
    });
  });

  test('each rules\' words are the plan\'s, true at Divided World\'s settings, and read their numbers from the rules and the settings', () => {
    const say = (k: string, s = instance.settings) => ui(k)!.describe(s);
    expect(say('happy-heart')).toBe(`A Sweet card, ${rules('happy-heart').rarity}, cast from any post by the character it lands on. It takes the oldest 2 warn points off that character's warn bar at once, as many as the lightest breach lands, or as many as are left. The filings stay on the record; the card is a new entry beside them. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.`);
    expect(say('super-happy-heart')).toBe(`A Sweet card, ${rules('super-happy-heart').rarity}, cast from any post by the character it lands on. It takes every point off that character's warn bar at once. The filings stay on the record; the card is a new entry beside them. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.`);
    expect(say('ultra-happy-heart')).toBe(`A Sweet card, ${rules('ultra-happy-heart').rarity}, cast from any post by a banned character. It ends that character's ban at once: the character can post, react and play cards again from that moment. The ban stays on the record and still counts toward how long that character's next ban is this season, and the warn bar is not touched. If the character is not banned the play is refused and you keep the card. A banned character cannot play cards, so another character plays it: anyone's, one of your own included. It is always cast face up. It costs nothing more to play.`);
    expect(say('take-the-fall')).toBe(`A Sweet card, ${rules('take-the-fall').rarity}, cast face up on a post by another character. The next time a Mod Bot's visit to that post files, its warn points land on the character that played this card instead of the post's author, and a ban they bring is that character's too. Only the points and the ban move: the post keeps its notice. One fits on a post. It waits until a visit files, the first filing uses it up, and it can be played while a visit is open. The character that took the fall can appeal the filing. It costs nothing more to play.`);
    expect(say('tattle-tale')).toBe(`A Salty card, ${tattleTale.rarity}, cast from any post by the character it lands on. For a week, when a Mod Bot's patrol picks which recent posts to look at, that character's posts are twice as likely to be picked. It makes a look likelier, never a ruling: the Mod Bot still judges each post against the rules, and a patrol still drops a finding against a character staff has already punished 3 times in the last 7 days. One fits on a character at a time, and it ends by itself. It is always cast face up. It costs nothing more to play.`);
    // The lightest band is the least of the three, in whatever order the settings hold them; one point is "1 warn point".
    expect(say('happy-heart', bands(5, 3, 9))).toContain('the oldest 3 warn points off');
    expect(say('happy-heart', bands(1, 3, 9))).toContain('the oldest 1 warn point off');
    expect(say('super-happy-heart', bands(5, 3, 9))).not.toMatch(/\d warn point/u);
    // The targeting cap is the settings'.
    expect(say('tattle-tale', cap(2, 14))).toContain('already punished 2 times in the last 14 days');
    retuned(tattleTale, 'lasts', { unit: 'day', count: 3 }, () => expect(say('tattle-tale')).toContain('For 3 days, when a Mod Bot'));
    for (const k of KEYS) {
      expect(say(k), k).not.toMatch(/set it face down|You can also set/u);
      expect(say(k), k).toMatch(/cast face up/iu);
    }
  });

  test('every one of them has a face in the cards list, and none joins the Moves that can be set face down', () => {
    const all = faces();
    for (const k of KEYS) expect(all.find((f) => f.key === k)?.describe, k).not.toContain('You can also set it face down');
    expect(all.filter((f) => KEYS.includes(f.key as never)).map((f) => f.kind)).toEqual(KEYS.map(() => 'Move'));
  });
});

describe('the cosmetics art files', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = (kind: 'gear' | 'trophies') => fs.readdirSync(path.join(dir, kind)).filter((f) => f.endsWith('.svg')).map((f) => [`${kind}/${f}`, fs.readFileSync(path.join(dir, kind, f), 'utf8')] as const);

  test('each gear piece\'s aspect is its viewBox height over width', () => {
    for (const [key, ui] of Object.entries(gearUi)) {
      const svg = fs.readFileSync(path.join(dir, 'gear', `${key}.svg`), 'utf8');
      const box = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/u.exec(svg);
      expect(box, key).not.toBeNull();
      expect(ui.aspect, key).toBeCloseTo(Number(box![2]) / Number(box![1]), 10);
    }
    expect(fs.readdirSync(path.join(dir, 'gear')).filter((f) => f.endsWith('.svg')).length).toBe(Object.keys(gearUi).length);
  });

  test('each art file is a bare SVG: no script, no link, no event attribute', () => {
    const all = [...files('gear'), ...files('trophies')];
    expect(all.length).toBeGreaterThan(0);
    for (const [name, svg] of all) {
      expect(svg.trimStart().startsWith('<svg'), name).toBe(true);
      expect(/<script/iu.test(svg), `${name} has a script`).toBe(false);
      expect(/href\s*=/iu.test(svg), `${name} has an href`).toBe(false);
      expect(/\son[a-z]+\s*=/iu.test(svg), `${name} has an event attribute`).toBe(false);
    }
  });
});

describe('Mooch, Toll, 4D Chess and Off Day in plain words (card notes Part 6, Task 9)', () => {
  const ui = (key: string) => instanceUi.cards.find((c) => c.key === key)!;
  const play = (config: Record<string, unknown>, over: Partial<CardPlay> = {}): CardPlay => ({ id: 'k', card: 'x', layer: 1, caster: null, message: '', config, playedAt: '2026-11-12T00:00:00.000Z', post: 'p', ...over });
  /* A rule's share, retuned for one test and put back: the words are read from the rules, never restated. */
  const retuned = <T,>(rules: object, key: string, value: unknown, run: () => T): T => {
    const held = (rules as Record<string, unknown>)[key];
    (rules as Record<string, unknown>)[key] = value;
    try { return run(); } finally { (rules as Record<string, unknown>)[key] = held; }
  };

  test('each wears Salty\'s pink or Pepperoni\'s color with its ink, and says what it does in a tagline and a summary', () => {
    for (const [key, color, ink, tagline] of [
      ['mooch', '#ff3d7f', '#14030a', 'Ride a post\'s reactions.'], ['toll', '#d24a2c', '#1a0602', 'Get paid when a Move lands here.'],
      ['4d-chess', '#ff3d7f', '#14030a', 'Get paid for the Move you saw coming.'], ['off-day', '#ff3d7f', '#14030a', 'Give a character somebody else\'s day.'],
    ] as const) {
      expect([ui(key).art.color, ui(key).art.ink, ui(key).art.tagline], key).toEqual([color, ink, tagline]);
      expect(ui(key).art.canvas, key).toMatch(/\.webp$/u);
      expect(ui(key).art.mark, key).toMatch(/\.svg$|^data:image\/svg\+xml/u);
    }
    expect(ui('mooch').summary).toBe('Names one kind of reaction on a post. For a week, each new vote the post draws there pays you a little, and costs its author nothing.');
    expect(ui('toll').summary).toBe('Used on your post. For a week, every reaction to a Move another player casts there pays you too.');
    expect(ui('4d-chess').summary).toBe('Set face down on your post, naming a Move up to uncommon and one kind of reaction. When that Move is cast there it lands as usual, and its reactions of that kind pay you.');
    expect(ui('off-day').summary).toBe('Cast on a character, naming a class. For the one settlement window after the next settlement, that character scores as that class.');
  });

  test('every status is within the Lens\'s word rules, for one play and for as many as the card stacks', () => {
    for (const key of ['mooch', 'toll', '4d-chess', 'off-day', 'sugar-coat', 'hype-up', 'last-word']) {
      const status = ui(key).status!;
      const rules = instance.cards.find((c) => c.key === key)!;
      for (let n = 1; n <= (rules.stack ?? 1); n++) expect(wordsProblems('status', typeof status === 'string' ? status : status(Array.from({ length: n }, () => ({}) as CardPlay))), `${key} with ${n}`).toEqual([]);
    }
  });

  test('Mooch says the reactions it names, counts its Mooches, and its words follow the rules\' share and week', () => {
    const status = ui('mooch').status as (p: readonly CardPlay[]) => string;
    expect(status([play({ quadrant: 'excitedNegative' })])).toBe('Mooching Heat off this post');
    expect(status([play({ quadrant: 'excitedNegative' }), play({ quadrant: 'calmPositive' })])).toBe('2 Mooches on this post');
    expect(ui('mooch').hint).toBe('A Mooch pays its caster when this post draws the reactions it named.');
    const say = () => ui('mooch').describe(instance.settings);
    expect(say()).toBe('A Salty card, uncommon. You name one of the four kinds of reaction. For a week, each vote the post draws there, from a player who had not reacted to the post before, pays you a tenth of a vote, whatever the author\'s class. It takes nothing from the author, and it pays nothing on a post of your own. A post holds one Mooch for each kind of reaction. You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on the quoting post at no further cost, using up the card. It costs nothing more to play.');
    expect(ui('mooch').logPlay!({ quadrant: 'boredNegative' }, {})).toBe('It names Groan: for a week, each new vote of Groan this post draws pays its caster a tenth of a vote. The post\'s author loses nothing.');
    expect(ui('mooch').logPlay!({}, {})).toBeUndefined();
    retuned(mooch, 'skim', { share: 0.5 }, () => {
      expect(say()).toContain('pays you half a vote, whatever');
      expect(ui('mooch').logPlay!({ quadrant: 'boredNegative' }, {})).toContain('pays its caster half a vote.');
    });
    retuned(mooch, 'lasts', { unit: 'day', count: 3 }, () => expect(say()).toContain('For 3 days, each vote'));
  });

  test('Toll says it pays its author for Moves cast on the post, from the rules\' share and week', () => {
    expect(ui('toll').status).toBe('Charging a toll on Moves');
    expect(ui('toll').hint).toBe('A Toll pays this post\'s author when a Move cast here draws reactions.');
    const say = () => ui('toll').describe(instance.settings);
    expect(say()).toBe('A Pepperoni card, uncommon, used on one of your own posts. For a week, each vote on a Move another player casts on that post pays you half a vote, on top of everything its caster earns: the caster loses nothing. A Move cast by one of your own characters pays you nothing. It costs nothing more to use.');
    expect(ui('toll').logPlay!({}, {})).toBe('Until it ends, each vote on a Move another player casts on that post pays you half a vote.');
    retuned(toll, 'gimmick', { kind: 'ride', share: 0.1 }, () => {
      expect(say()).toContain('pays you a tenth of a vote, on top');
      expect(ui('toll').logPlay!({}, {})).toContain('pays you a tenth of a vote.');
    });
  });

  test('4D Chess says what it waits for and what it pays, with the same words as every Reversal for its status, from the rules\' share, rarity and set time', () => {
    expect(ui('4d-chess').status).toBe('Set, face down to everyone else');
    expect(ui('4d-chess').status).toBe(ui('card-collector').status);
    const say = () => ui('4d-chess').describe(instance.settings);
    expect(say()).toBe(`A Salty card, uncommon, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. You name one Move, uncommon or commoner, and one of the four kinds of reaction. When that Move is cast on your post, this springs and shows itself; the Move lands as usual and its caster keeps everything it earns, and from then on each vote of your kind on that Move pays you a vote. A Move cast by one of your own characters springs it and pays you nothing. It springs once, or comes back to your hand after ${instance.settings.setLasts.count} ${instance.settings.setLasts.unit}s if nothing springs it. It costs nothing more to set.`);
    retuned(fourDChess, 'trap', { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 0.5 } }, () => expect(say()).toContain('pays you half a vote.'));
    expect(ui('4d-chess').describe({ ...instance.settings, setLasts: { unit: 'day', count: 1 } })).toContain('after 1 day if nothing');
  });

  test('Off Day says the class it names and when, before its window opens and from then', () => {
    const status = ui('off-day').status as (p: readonly CardPlay[]) => string;
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const later = new Date(Date.now() + 90_000_000).toISOString();
    const before = play({ class: 'heel' }, { starts: soon, ends: later });
    expect(status([before])).toBe('Scores as a Heel next window');
    const open = play({ class: 'heel' }, { starts: new Date(Date.now() - 3_600_000).toISOString(), ends: soon });
    expect(status([open])).toBe('Scoring as a Heel now');
    expect(status([open, before])).toBe('Scoring as a Heel now');
    expect(status([play({ class: 'face' }, { starts: soon, ends: later })])).toBe('Scores as a Face next window');
    expect(ui('off-day').hint).toBe('An Off Day makes a character score as another class for one settlement window.');
    expect(ui('off-day').describe(instance.settings)).toBe('A Salty card, legendary, cast from any post by the character it lands on. You name a class, and everyone can see which. From the next settlement until the one after it, that character is scored as that class, whatever its own. Its own class does not change, no Turn is used and its Turn cooldown is untouched. You are never told whether it made a difference; the character\'s player is told exactly what happened. A character takes one Off Day for each window. You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on the quoting post\'s character at no further cost, using up the card. It costs nothing more to play.');
    expect(ui('off-day').logPlay!({ class: 'tweener' }, { starts: '2026-11-12T08:17:00.000Z', ends: '2026-11-13T08:17:00.000Z' }))
      .toBe('From the settlement of Nov 12 \u00b7 08:17 UTC to the settlement of Nov 13 \u00b7 08:17 UTC, that character scores as a Tweener. Its own class does not change, no Turn is used, and its Turn cooldown is untouched.');
    expect(ui('off-day').logPlay!({ class: 'tweener' }, {})).toBeUndefined();
    expect(ui('off-day').logPlay!({}, { starts: '2026-11-12T08:17:00.000Z', ends: '2026-11-13T08:17:00.000Z' })).toBeUndefined();
    expect(offDay.reaches).toEqual(['character']);
  });

  test('a settled payout names its card, says the share from the card\'s rules, and a card this instance does not have is "A card"', () => {
    expect(REASON_KEYS).toEqual(expect.arrayContaining(['card.skim', 'card.ride']));
    const said = (reason: string, card: unknown) => instanceUi.reasonWords(reason, { card: card as string });
    expect(said('card.skim', 'mooch')).toBe('Mooch: a tenth of a vote for each vote its post drew in the reactions it named, from players who first reacted after it');
    expect(said('card.ride', 'toll')).toBe('Toll: half a vote for each vote on a Move another player cast on the post');
    expect(said('card.ride', '4d-chess')).toBe('4D Chess: a vote for each vote, of the kind it named, on the Move that sprang it');
    for (const reason of ['card.skim', 'card.ride']) {
      expect(said(reason, 'gone'), reason).toMatch(/^A card: what its payout on a reaction earned$/u);
      expect(said(reason, undefined)).toBe('A card: what its payout on a reaction earned');
    }
    /* A card that is neither a skim for a skim reason, nor a ride for a ride reason, is "A card" too. */
    expect(said('card.skim', 'toll')).toBe('A card: what its payout on a reaction earned');
    expect(said('card.ride', 'mooch')).toBe('A card: what its payout on a reaction earned');
    retuned(mooch, 'skim', { share: 0.25 }, () => expect(said('card.skim', 'mooch')).toContain('Mooch: a quarter of a vote for each vote'));
    retuned(toll, 'gimmick', { kind: 'ride', share: 1 }, () => expect(said('card.ride', 'toll')).toContain('Toll: a vote for each vote'));
  });

  test('Graffiti is composed on the post, lies beneath every splat, and says what it does in the glass\'s plain words', () => {
    const g = ui('graffiti');
    expect(g.Compose).toBeDefined();
    expect(g.Effect).toBeDefined();
    expect(g.beneath).toBe(true);
    expect(g.art.tagline).toBe('Turn a post into a wall.');
    expect(g.summary).toBe('Turn a post into a wall anyone can tag. The author can wash it off; anyone can tag it again.');
    expect(g.status).toBe('A wall anyone can tag');
    expect(wordsProblems('status', g.status as string)).toEqual([]);
    expect(g.hint).toBe('Press Draw to tag this wall. Scrub it away on your screen any time.');
    expect(g.hint).not.toMatch(/\d/u);
    const said = g.describe(instance.settings);
    expect(said).toContain('up to 40% of the post');
    expect(said).toContain('The post\'s author can wash it off for everyone, and anyone can tag it again.');
    expect(said).toContain('A reader can scrub the paint off on their own screen');
    expect(said).not.toMatch(/colour|grey|tick /u);
    expect(g.describe({ ...instance.settings, cardSettings: { ...instance.settings.cardSettings, 'graffiti.limit': 25 } })).toContain('up to 25% of the post');
  });

  test('Graffiti\'s words about a drawing read from the Act alone: its colors or its stencil, and the sponge for a wash', () => {
    expect(describeDraw({ strokes: [{ can: 'pink', cap: 'fat', aspect: 1, points: [[0, 0]] }, { can: 'lime', cap: 'fat', aspect: 1, points: [[0, 0]] }] })).toBe('pink and lime');
    expect(describeDraw({ stencil: 'crown', can: 'pink', spot: 1, strokes: [] })).toBe('a crown in pink');
    expect(ui('graffiti').describeDraw).toBe(describeDraw);
    expect(ui('graffiti').logDraw).toEqual(LOG_DRAW);
    expect(ui('graffiti').logWash).toEqual(LOG_WASH);
  });

  test('every status passes the instance check, and the check is run against the real instance', () => {
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
  });
});

describe('Divided World\'s sounds', () => {
  const soundsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sounds');
  const manifest = JSON.parse(fs.readFileSync(path.join(soundsDir, 'sounds.json'), 'utf8')) as { file: string }[];
  const manifestFiles = manifest.map((m) => m.file);
  /* The table the design gives, one row per slot, in order. */
  const TABLE = [
    { key: 'laugh-track.laugh-1', file: 'laugh-1.mp3', caption: 'The audience laughs', ink: 'var(--kb-pepperoni)' },
    { key: 'laugh-track.laugh-2', file: 'laugh-2.mp3', caption: 'The audience laughs', ink: 'var(--kb-pepperoni)' },
    { key: 'laugh-track.laugh-3', file: 'laugh-3.mp3', caption: 'The audience laughs', ink: 'var(--kb-pepperoni)' },
    { key: 'laugh-track.cheer-1', file: 'cheer-1.mp3', caption: 'The audience cheers', ink: 'var(--kb-sweet)' },
    { key: 'laugh-track.cheer-2', file: 'cheer-2.mp3', caption: 'The audience cheers', ink: 'var(--kb-sweet)' },
    { key: 'laugh-track.cheer-3', file: 'cheer-3.mp3', caption: 'The audience cheers', ink: 'var(--kb-sweet)' },
    { key: 'laugh-track.boo-1', file: 'boo-1.mp3', caption: 'The audience boos', ink: 'var(--kb-salty)' },
    { key: 'laugh-track.boo-2', file: 'boo-2.mp3', caption: 'The audience boos', ink: 'var(--kb-salty)' },
    { key: 'laugh-track.boo-3', file: 'boo-3.mp3', caption: 'The audience boos', ink: 'var(--kb-salty)' },
    { key: 'laugh-track.titter', file: 'titter.mp3', caption: 'The audience titters', ink: 'var(--kb-pepperoni)', loop: true },
    { key: 'laugh-track.ooh', file: 'ooh.mp3', caption: 'The audience goes “ooh”', ink: 'var(--kb-sweet)', loop: true },
    { key: 'laugh-track.grumble', file: 'grumble.mp3', caption: 'A grumble rises', ink: 'var(--kb-salty)', loop: true },
  ];
  const slots = instanceUi.sounds?.slots ?? [];

  test('there are exactly the twelve slots of the design, in order, with their keys, captions, inks and loops', () => {
    expect(slots.map((s) => s.key)).toEqual(TABLE.map((t) => t.key));
    for (const row of TABLE) {
      const slot = slots.find((s) => s.key === row.key);
      expect(slot, `${row.key} is a slot`).toBeDefined();
      expect(slot!.caption, `${row.key}'s caption`).toBe(row.caption);
      expect(slot!.ink, `${row.key}'s ink`).toBe(row.ink);
      expect(slot!.loop, `${row.key}'s loop`).toEqual(row.loop ? true : undefined);
    }
    expect(slots).toHaveLength(12);
  });
  test('every slot plays on the game bus', () => {
    for (const slot of slots) expect(slot.bus, `${slot.key}'s bus`).toBe('game');
  });
  test('every slot\'s file is in the folder\'s manifest, and is the file the design names', () => {
    for (const row of TABLE) {
      const slot = slots.find((s) => s.key === row.key)!;
      expect(manifestFiles, `${row.file} is in sounds.json`).toContain(row.file);
      expect(path.posix.basename(slot.src.split(/[?#]/u)[0]!), `${row.key}'s file`).toBe(row.file);
    }
  });
  test('every caption is non-empty and every key is unique', () => {
    for (const slot of slots) expect(slot.caption.trim(), `${slot.key}'s caption`).not.toBe('');
    expect(new Set(slots.map((s) => s.key)).size).toBe(slots.length);
  });
  test('the preview names a slot, the game bus\'s', () => {
    expect(instanceUi.sounds?.preview?.game).toBe('laugh-track.laugh-1');
    expect(slots.map((s) => s.key)).toContain(instanceUi.sounds?.preview?.game);
  });
});

/* The engine's card draws its own ring (engine/ui/cards/postcard.css): a Use's is not painted, so a rule here that painted one would lay a solid ring under its dashes. */
describe('Divided World\'s stylesheets and the card\'s ring', () => {
  test('no rule paints a card\'s ring in a width or color of its own', () => {
    expect(ringFaults(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))).toEqual([]);
  });
});

/** Each rule under `root`, outside postcard.css, that paints a ring on a card (a shadow with no offset or blur) in a width or color of its own. */
function ringFaults(root: string): string[] {
  const faults: string[] = [];
  for (const file of fs.readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css') && path.basename(f) !== 'postcard.css' && !f.includes('node_modules'))) {
    for (const m of fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      if (!/\.kb-postcard(?![-\w])/u.test(m[1]!)) continue;
      for (const shadow of /box-shadow:([^;]*)/u.exec(m[2]!)?.[1]?.split(/,(?![^(]*\))/u) ?? []) {
        if (/^\s*0 0 0 \S/u.test(shadow) && !shadow.includes('inset') && shadow.trim() !== '0 0 0 var(--kb-pc-ring) var(--kb-pc-ring-color)') faults.push(`${file}: ${m[1]!.trim()} { ${shadow.trim()} }`);
      }
    }
  }
  return faults;
}

/* The screens ask where each card lands with no settings at all (engine/ui/cards/land.ts): a card whose rules read the economy while deciding a
   play (You Were Saying?'s length) once threw on every post it was offered on. Each of the instance's cards is asked as the screens ask it. */
describe('where each card lands, as the screens ask it', () => {
  test('every card is asked on a post, face up and face down, without reading settings the screens do not hold', () => {
    const target = { reach: 'post', act: 'p1', kind: 'post', length: 2, text: 'hi' } as const;
    for (const rules of instance.cards) {
      expect(() => landingOn(rules, target, [], { cards: instance.cards }), rules.key).not.toThrow();
      expect(() => landingOn(rules, target, [], { cards: instance.cards, faceDown: true }), rules.key).not.toThrow();
    }
    expect(landingOn(instance.cards.find((c) => c.key === 'you-were-saying')!, target, [], { cards: instance.cards }).ok).toBe(true);
  });
});
