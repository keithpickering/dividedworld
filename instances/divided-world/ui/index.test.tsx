import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ratio } from '../../../engine/ui/contrast.ts';
import { glassVars } from '../../../engine/ui/glass/apply.ts';
import { boardSwitch } from '../../../engine/ui/glass/board.ts';
import { SURFACES } from '../../../tools/check-glass-contrast.mjs';
import { guideFaults, privacyOverclaims, readInstance } from '../../../tools/check-guide.mjs';
import { parse, sectionsOf } from '../../../engine/ui/guide/markdown.ts';
import { QUADRANTS } from '../../../engine/rules/types.ts';
import { economyOf, faceUpOnly, playOf, reachesOf } from '../../../engine/rules/cards.ts';
import { instanceUiProblems } from '../../../engine/ui/tips/problems.ts';
import { TIP_KEYS } from '../../../engine/ui/tips/keys.ts';
import { instance } from '../index.ts';
import { faceOf, facesOf } from '../../../engine/ui/cards/faces.ts';
import { landingOn } from '../../../engine/ui/cards/land.ts';
import { nameLines } from '../../../engine/ui/cards/nameLines.ts';
import { SIZES } from '../../../engine/ui/cards/template.ts';
import { logRows } from '../../../engine/ui/log/lines.ts';
import type { Act, Log } from '../../../engine/ui/data/api.ts';
import type { ClassInput } from '../../../engine/rules/types.ts';
import { instanceUi, REASON_KEYS, settingsRead, wordsRead } from './index.ts';
import { cardsUi, spanWords } from './cards.ts';
import { webpSize } from '../../../engine/ui/profile-edit/webp.ts';
import { gearOf, gearUi } from './cosmetics.ts';
import { webpInfo } from '../../../tools/art-files.mjs';
import { gainOf } from './sounds.ts';
import { mooch } from '../cards/mooch.ts';
import { objectOf } from './steel-chair/objects.ts';
import { frontDoorPlayId } from '../../../engine/ui/front-door/ids.ts';
import { toll } from '../cards/toll.ts';
import { lineCutter } from '../cards/line-cutter.ts';
import { feelinGlam } from '../cards/feelin-glam.ts';
import { feelinFab } from '../cards/feelin-fab.ts';
import { LayerInk, coveredLines } from '../cards/whoops/scrub.ts';
import { makeSplat } from '../cards/whoops/splat.ts';
import { savedOf } from '../cards/whoops/Effect.tsx';
import { fourDChess } from '../cards/4d-chess.ts';
import { offDay } from '../cards/off-day.ts';
import { popSteal } from '../cards/pop-steal.ts';
import { ropeBreak } from '../cards/rope-break.ts';
import { whoopeeCushion } from '../cards/whoopee-cushion.ts';
import { payItForward } from '../cards/pay-it-forward.ts';
import { kickMe } from '../cards/kick-me.ts';
import { CUES, laughTrack } from '../cards/laugh-track.ts';
import { WORDS as THIS_WORDS, thisCard } from '../cards/this.ts';
import { HOT_BOX_THINS, hotBox } from '../cards/hot-box.ts';
import { setMoveWords } from './cards/words.ts';
import { LOG_DRAW, LOG_WASH, describeDraw } from '../cards/graffiti/words.ts';
import { wordsProblems } from '../../../engine/ui/cards/lens-words.ts';
import type { CardPlay } from '../../../engine/ui/cards/types.ts';
import { ENGINE_DEFAULT_PRONOUNS, PRONOUN_PRESETS } from '../../../engine/rules/pronouns.ts';
import { sounds } from './sounds.ts';

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
    expect(instanceUi.frontDoor.cast.map((c) => c.name)).toEqual(['Snuckles', 'Hotel Mario', 'Chadluminum', 'Serious Deer', 'D-Guy']);
    /* One of each class that posts, each through the postbit's real revealed line: the Lurker never posts, so it is absent by design. */
    expect(instanceUi.frontDoor.cast.map((c) => c.revealed?.class)).toEqual(['jabroni', 'heel', 'face', 'technician', 'tweener']);
    expect(instanceUi.frontDoor.posts).toHaveLength(10);
    /* A picture is a URL the bundler gave (a `?url` import), never a hand-typed path: a typed one 404s and the postbit shows a broken image. */
    for (const c of instanceUi.frontDoor.cast.filter((c) => c.avatarSquare !== undefined)) {
      expect(c.avatarSquare, `${c.name}'s square`).toMatch(/\.(jpg|png)$|^data:image\//u);
      expect(c.avatarPortrait, `${c.name}'s portrait`).toMatch(/\.(jpg|png)$|^data:image\//u);
    }
    expect(instanceUiProblems(instanceUi, instance).filter((p) => /front door/u.test(p))).toEqual([]);
  });
  test('Snuckles\'s exit is hit by the three who argued, united: two folding chairs, then a fire extinguisher', () => {
    const exit = instanceUi.frontDoor.posts[9]!;
    expect(exit.by).toBe('snuckles');
    const plays = exit.plays ?? [];
    expect(plays.map((p) => [p.card, p.by])).toEqual([['steel-chair', 'hotelmario'], ['steel-chair', 'chadluminum'], ['steel-chair', 'deer']]);
    /* What each throws is rolled from its play's id (./steel-chair/objects.ts), so the ids are the instance's, picked for these rolls. */
    expect(plays.map((p, j) => objectOf(frontDoorPlayId(9, j, p)))).toEqual(['chair', 'chair', 'extinguisher']);
  });
  test('Hotel Mario\'s wash is a couple of hurried streaks: every line of #3 is just legible at a desktop box and a phone\'s, and most of the ink stays', () => {
    const play = instanceUi.frontDoor.posts[2]!.plays![0]!;
    expect(play.card).toBe('whoops');
    const splat = makeSplat(Number(play.config.seed));
    const strokes = savedOf(play.state).strokes;
    const text = instanceUi.frontDoor.posts[2]!.body;
    /* The post body at a 1280px window (one line of words) and on an iPhone 13 (three lines), measured on the rendered board, in css px. */
    for (const { w, h, lines } of [{ w: 987, h: 352.5, lines: [[7, 29.5]] }, { w: 372.4, h: 352.5, lines: [[13, 35], [35, 57], [57, 79]] }]) {
      const box = { w, h };
      const ink = new LayerInk(splat, strokes, box);
      const bare = new LayerInk(splat, [], box);
      const at = lines.map(([top, bottom]) => ({ top: top! / h, bottom: bottom! / h, text }));
      expect(coveredLines(at, [ink]), `at ${w}px no line of the words lies under ink`).toEqual(at.map(() => false));
      expect(coveredLines(at, [bare]).some(Boolean), `at ${w}px the unwashed splat hides a line, so the wash is what lets it read`).toBe(true);
      const left = 1 - ink.washed;
      expect(left, `at ${w}px ink left ${left}`).toBeGreaterThan(0.85);
    }
  });
  test('the letter opens as Gabe\'s welcome does', () => {
    expect(instanceUi.onboarding.letter).toMatch(/^## Hi\. I'm Gabe\./u);
  });
  test('the letter\'s first block is a heading, which the welcome page draws as its headline', () => {
    expect(parse(instanceUi.onboarding.letter)[0]?.t).toBe('heading');
  });
  test('the letter holds no conditional and no marker', () => {
    expect(instanceUi.onboarding.letter).not.toMatch(/<!--|\{\{|kayfabb/u);
  });
  test('no tip and no line of the front door\'s note says "The System" or "Administrator"', () => {
    const lines = [
      ...Object.values(instanceUi.onboarding.tips).flatMap((t) => [t.title, t.line]),
      ...instanceUi.frontDoor.note.split('\n'),
    ];
    for (const line of lines) expect(line, line).not.toMatch(/The System|Administrator/u);
  });
  test('no tip and no line of the front door\'s note claims more privacy than the game gives (#1145): "no other player", never "only you"', () => {
    const lines = [
      ...Object.values(instanceUi.onboarding.tips).flatMap((t) => [t.title, t.line]),
      ...instanceUi.frontDoor.note.split('\n'),
      instanceUi.onboarding.letter,
    ];
    for (const line of lines) expect(privacyOverclaims(line), line).toEqual([]);
  });
});

describe('Divided World\'s gear and trophy art', () => {
  test('every gear has a default view it ships, and each view a URL, a size and a pivot inside it, and every trophy kind has a badge, and nothing else does', () => {
    expect(Object.keys(instanceUi.gear).sort()).toEqual(instance.gear.map((g) => g.key).sort());
    for (const g of instance.gear) {
      const item = instanceUi.gear[g.key]!;
      expect(item.views[item.default], `${g.key} ships its default view ${item.default}`).toBeDefined();
      for (const [view, v] of Object.entries(item.views)) {
        const at = `${g.key}'s ${view}`;
        expect(v.art, `${at} art`).toEqual(expect.any(String));
        expect(v.width, `${at} width`).toBeGreaterThan(0);
        expect(v.height, `${at} height`).toBeGreaterThan(0);
        expect(v.pivot.x, `${at} pivot x`).toBeGreaterThanOrEqual(0);
        expect(v.pivot.x, `${at} pivot x`).toBeLessThanOrEqual(v.width);
        expect(v.pivot.y, `${at} pivot y`).toBeGreaterThanOrEqual(0);
        expect(v.pivot.y, `${at} pivot y`).toBeLessThanOrEqual(v.height);
      }
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
  test('Gabe\'s sign-off is two short lines in both the letter and the guide: a hard break, no paragraph gap', () => {
    for (const [name, md] of [['letter', instanceUi.onboarding.letter], ['guide', instanceUi.guide.markdown]] as const) {
      const last = parse(md).filter((b) => b.t === 'p').at(-1)!;
      expect(last, name).toEqual({ t: 'p', children: [{ t: 'text', text: 'Have fun,' }, { t: 'br' }, { t: 'text', text: 'Gabe' }] });
    }
  });
  test('never says "The System" in what a player reads (the comment at its top is not read)', () => {
    const shown = instanceUi.guide.markdown.replace(/<!--[\s\S]*?-->/gu, '');
    expect(shown).not.toContain('The System');
  });
  test('its sections, read as the page reads them, are in this order', () => {
    const titles = sectionsOf(parse(instanceUi.guide.markdown), (p) => `{{setting:${p}}}`).map((s) => s.title);
    expect(titles).toEqual([
      'Welcome letter', 'The metagame', 'Your first character', 'Reactions', 'Aura', 'Seasons', 'Classes', 'Turns and reveals',
      'Cards', 'The masks', 'The staff', 'Things that happen to you', 'The actual rules', 'Coming attractions',
    ]);
  });
  test('"The actual rules" is real moderation, so the persona does not speak in it', () => {
    const md = instanceUi.guide.markdown;
    const rules = md.slice(md.indexOf('## The actual rules'), md.indexOf('## Coming attractions'));
    expect(rules).toContain('## The actual rules');
    /* The plan's "I ", "I'm", "my " and "yacht", read as whole words, so "I'd", "I've" and "I'll" count and "enemy" does not. */
    for (const word of [/\bI\b/u, /\bmy\b/iu, /yacht/iu]) expect(rules, String(word)).not.toMatch(word);
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
  /* Where a set card lands is its reach, said in the instance's own words for it: a post, that post's character, or that post's thread. */
  const LANDS_ON: Readonly<Record<string, string>> = { post: 'the quoting post', character: "the quoting post's character", thread: "the quoting post's thread" };
  const settable = instance.cards.filter((c) => playOf(c) === 'cast' && !faceUpOnly(c));
  test('every card that can be set face down says so, landing at its own reach and no other', () => {
    expect(settable.length, 'the rule checks a card').toBeGreaterThan(0);
    for (const c of settable) {
      expect(reachesOf(c), `${c.key} reaches one thing`).toHaveLength(1);
      const reach = LANDS_ON[reachesOf(c)[0]!];
      expect(reach, `${c.key}'s reach is one the rule has words for`).toBeDefined();
      expect(face(c.key).describe, c.key).toContain(`You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on ${reach} at no further cost, using up the card.`);
    }
    /* A card that cuts is faceUpOnly: it is no row of the table above, and its sheet holds no face-down offer or landing place. */
    const cut = instance.cards.find((c) => c.key === 'buzzkill')!;
    expect(settable.map((c) => c.key)).not.toContain('buzzkill');
    expect(faceUpOnly(cut)).toBe(true);
    expect(face('buzzkill').describe).not.toMatch(/You can also set it face down/u);
    expect(face('autocorrect').describe).toMatch(/set one lands only when the quote's own words hold its phrase/u);
    expect(face('this').describe).toMatch(/set one lands only when the quote's own words hold its phrase/u);
  });
  test('Line Cutter holds no face-down sentence, and every word of its face is the plan\'s, true to its rules', () => {
    const t = face('line-cutter');
    const ui = instanceUi.cards.find((c) => c.key === 'line-cutter')!;
    expect(ui.Effect).toBeUndefined();
    expect(ui.art.tagline).toBe('Reply right under a post.');
    expect([ui.art.color, ui.art.ink]).toEqual(['#d24a2c', '#0d0301']);
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
  test("Glitter Bomb's words say what the week leaves, and never promise more than an admin's end allows (issue #635)", () => {
    const ui = instanceUi.cards.find((c) => c.key === 'glitter-bomb')!;
    const described = typeof ui.describe === 'function' ? ui.describe(instance.settings) : ui.describe;
    expect(described).toContain("For a week, every one of that character's posts sparkles, wherever it is. When the week is up, the posts written during it keep their sparkle after it ends, settled; every other post stops.");
    expect(ui.logPlay!({}, {})).toBe('Posts that character writes before it ends keep their sparkle after it ends.');
    expect(`${described} ${ui.logPlay!({}, {})}`).not.toMatch(/for good|where it landed/u);
  });
  test('the guide names the three kinds and says every card back looks the same, with no payout from a trap', () => {
    expect(guideMd).toMatch(/- \*\*Move, Reversal, Gimmick\.\*\*/u);
    expect(guideMd).toMatch(/A \*\*Move\*\* is cast on a target/u);
    expect(guideMd).toMatch(/A \*\*Reversal\*\* is only ever set face down on your own post/u);
    expect(guideMd).toMatch(/A \*\*Gimmick\*\* is played face up on your own post, your own character, or a thread your own character started/u);
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
    expect(say('publicity-tour'), 'publicity-tour').toMatch(/3 days[\s\S]*positive vote[\s\S]*pays half a vote more/u);
    expect(say('heat-magnet'), 'heat-magnet').toMatch(/3 days[\s\S]*negative vote[\s\S]*pays three quarters of a vote more/u);
    expect(say('hype-up')).toMatch(/3 days[\s\S]*positive vote[\s\S]*pays its author a vote more/u);
    expect(say('sugar-coat')).toMatch(/a week[\s\S]*Salty or Pepperoni/u);
    expect(say('last-word')).toMatch(/a week[\s\S]*refused before it is written/u);
    expect(say('class-clown')).toMatch(/3 days[\s\S]*each 😂 and each 🙄 on its posts pays a vote more/u);
    for (const key of ['publicity-tour', 'heat-magnet', 'hype-up', 'class-clown']) expect(say(key), key).not.toMatch(/%|doubled|higher/u);
    expect(say('good-vibes')).toMatch(/3 days[\s\S]*costs 0\.25 more/u);
  });
});

describe('Required Reading\'s face and sheet', () => {
  const entry = instanceUi.cards.find((c) => c.key === 'required-reading');
  /* Wrap greedily at spaces, as the plate does. Issue #772's check of every tagline against the plate replaces this when it lands. */
  const wrap = (text: string, width: number) => {
    const lines: string[] = [];
    for (const word of text.split(' ')) {
      const last = lines.length - 1;
      if (last >= 0 && lines[last]!.length + 1 + word.length <= width) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    return lines;
  };

  test('its face and its sheet say what the plan says', () => {
    expect(entry, 'a required-reading entry in the card list').toBeDefined();
    expect(entry!.art.color).toBe('#2ee6ff');
    expect(entry!.art.ink).toBe('#03141a');
    expect(entry!.art.tagline).toBe('Earn more from calm praise on a post.');
    expect(entry!.summary).toBe('Used on your post. For a week, each calm positive vote on it pays a vote more.');
    expect(entry!.status).toBe('Paid more for calm positive votes');
    expect(entry!.describe(instance.settings)).toBe(
      'A Sweet card, common, used on one of your own posts. For a week, each calm positive vote on that post pays its author a vote more, whatever their class makes of it, and then it stops by itself. It counts votes from players who first react to a post while it is up. A post carries one at a time. Where two cards pay on the same vote, only the larger pays. It costs nothing more to use.',
    );
    expect(entry!.logPlay!({}, {})).toBe('Each calm positive vote on that post pays up to a vote more until it ends.');
    expect('Effect' in entry!, 'no Effect').toBe(false);
    expect('ConfigForm' in entry!, 'no ConfigForm').toBe(false);
  });

  test('its tagline fits the plate: two lines of at most 20 characters', () => {
    const lines = wrap(entry!.art.tagline!, 20);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(20);
  });

  test('its words hold no percent sign and no class\'s name', () => {
    const words = [entry!.art.tagline, entry!.summary, entry!.status, entry!.describe(instance.settings), entry!.logPlay!({}, {})].map((w) => String(w));
    for (const w of words) {
      expect(w, w).not.toMatch(/%/u);
      for (const c of instance.classes) expect(w.toLowerCase(), `${c.name} in "${w}"`).not.toContain(c.name.toLowerCase());
    }
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
  /* The settings beside the economy a reason states, each shifted by 17 too, so a default the economy shares (three days, three voices) is never read for the other's. */
  const settingsShifted = (key: string) => Object.fromEntries((settingsRead[key] ?? []).map((r) => [r, instance.settings[r] + 17]));
  test('each class\'s words say the numbers in force: shifted by 17, the shifted number is said and the default is not', () => {
    expect(Object.keys(wordsRead).length).toBeGreaterThan(0);
    for (const [key, reads] of Object.entries(wordsRead)) {
      const shifted = { ...economy, ...Object.fromEntries(reads.map((r) => [r, economy[r]! + 17])), ...settingsShifted(key) };
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
      character: 'lu', from: 0, to: 1, posts: [1, 2, 3, 4, 5].map((n) => ({ act: `p${n}`, at: n })), received: [], given: [], held: [], cardsPlayed: [], cardsLanded: [], standings: [], debates: [],
      threadsSpun: [{ act: 's1', thread: 't', at: 1, fromOthers: true, repliersBefore: 0, repliersNow: economy['lurker.spunThreadRepliers']! }],
    }, instance.settings);
    const tweener = instance.classes.find((c) => c.key === 'tweener')!;
    const lit = tweener.earn({
      character: 'tw', from: 0, to: 10, posts: [], received: [], given: [], held: [], cardsPlayed: [], cardsLanded: [], standings: [], threadsSpun: [],
      debates: [{ act: 'p1', at: 0, posts: [1, 2, 1, 2, 3].map((voice, n) => ({ at: n + 1, voice })), inOwnDebate: false, standing: { before: [], now: [] }, cushioned: 0, paid: {}, placed: true }],
    }, instance.settings);
    const reasons = [...new Set([...Object.keys(wordsRead), ...Object.keys(settingsRead)])].filter((k) => k.includes('.'));
    for (const reason of reasons) {
      const carried = [...earned, ...lit].filter((e) => e.reason === reason);
      expect(carried.length, `${reason} is earned here`).toBeGreaterThan(0);
      for (const e of carried) expect(Object.keys(e.params ?? {}).sort(), reason).toEqual([...(wordsRead[reason] ?? []), ...(settingsRead[reason] ?? [])].sort());
    }
  });
  test('the Heel\'s multiple reads true at every value the setting allows', () => {
    const at = (v: number) => said('heel', { ...economy, 'heel.heatVotes': v });
    expect(at(0)).toContain('which pay nothing');
    expect(at(0)).not.toMatch(/times over|zero|each paid/);
    expect(at(1)).toContain('each paid as one vote');
    expect(at(1)).not.toMatch(/times over|one times/);
    expect(at(2)).toContain('each paid double');
    expect(at(3)).toContain('each paid triple');
    expect(at(4)).toContain('each paid four times over');
    expect(at(25)).toContain('each paid 25 times over');
    expect(at(1.5)).toContain('each paid one and a half times over');
    expect(at(2.5)).toContain('each paid two and a half times over');
    expect(at(1.25)).toContain('each paid 1.25 times over');
    expect(at(1.5)).not.toMatch(/\d/);
    expect(at(0.5)).toContain('each paid as half a vote');
    expect(at(0.5)).not.toMatch(/zero/);
  });
  test('the double the Heel and the Jabroni earn is said, and the Lurker\'s miss and the reveal perk are worded', () => {
    expect(wordsRead['heel']).toContain('heel.heatVotes');
    expect(wordsRead['jabroni']).toContain('jabroni.groanVotes');
    expect(said('heel', economy)).toContain('double');
    expect(said('jabroni', economy)).toContain('double');
    expect(said('lurker', economy)).toContain('Hurt by early calls that go the other way');
    expect(instanceUi.reasonWords('lurker.misread', economy)).toBe('Misread it: among the first to react to a post that then drew a crowd another way');
    expect(instanceUi.reasonWords('crowd.floor', {}, 2)).toBe('The crowd noticed: a reaction the character\'s class neither pays nor charges');
    expect(instanceUi.reasonWords('crowd.floor', {})).toBe('The crowd noticed: a reaction the character\'s class neither pays nor charges');
    expect(instanceUi.reasonWords('crowd.floor', {}, -2)).toBe('The crowd noticed: taken back, for a vote that moved off a quadrant where it was paid');
    expect(REASON_KEYS).toContain('crowd.floor');
    expect(instanceUi.reasonWords('reveal.perk', { share: 0.2 })).toBe('Playing it openly: a fifth more on what reactions earned while the character\'s reveal was current');
  });
  test('the Tweener\'s catalyst lines say the numbers they were settled under, and its description says it earns from a debate', () => {
    expect(instanceUi.reasonWords('tweener.litTheFuse', { 'tweener.catalystVoices': 4, 'tweener.catalystReturned': 3, debateDays: 5 })).toBe(
      'Lit the fuse: within five days of the character\'s post, four or more other players were arguing under it, three of them more than once, in quotes of it and threads spun from it, and the character\'s player had not posted in it');
    expect(instanceUi.reasonWords('tweener.litTheFuse', economy)).toMatch(/^Lit the fuse: within three days .* three or more other players .* two of them more than once/u);
    expect(instanceUi.reasonWords('tweener.outvoted', {})).toBe(
      'Outvoted: the players arguing under the character\'s post cancel its calm and bored reactions, a player for each vote, less the share a cushion card has covered. Taken back where a reaction moved away');
    expect(said('tweener', economy)).toContain('Also earns when its post sets others debating and it stays out, and the debate cancels that post\'s shrugs.');
  });
  test('a setting a reason states beside the economy is said as tuned: shifted by 17, the shifted number is said and the default is not', () => {
    expect(Object.keys(settingsRead).length).toBeGreaterThan(0);
    const s = instance.settings;
    for (const [reason, reads] of Object.entries(settingsRead)) {
      const economyShifted = Object.fromEntries((wordsRead[reason] ?? []).map((r) => [r, economy[r]! + 17]));
      const text = instanceUi.reasonWords(reason, { ...economy, ...economyShifted, ...settingsShifted(reason) });
      for (const r of reads) {
        expect(text, `${reason} says ${r} as tuned`).toMatch(new RegExp(`\\b${spelled(s[r] + 17)}\\b`, 'u'));
        expect(text, `${reason} never says ${r}'s default`).not.toMatch(new RegExp(`\\b${spelled(s[r])}\\b`, 'u'));
      }
    }
  });
  test('every class description and reason that states a number names the economy keys it states', () => {
    for (const key of [...instance.classes.map((c) => c.key), ...REASON_KEYS]) {
      if (holdsNumber(said(key, economy))) expect(wordsRead[key]?.length ?? 0, `${key}: "${said(key, economy)}"`).toBeGreaterThan(0);
    }
  });
  test('the screen entries are listed in key order, one for each card and none spare', () => {
    const keys = cardsUi.map((c) => c.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(instance.cards.map((c) => c.key));
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
  test('Steel Chair and Laugh Track name the sounds their effects play', () => {
    const steel = instanceUi.cards.find((c) => c.key === 'steel-chair')!;
    expect(steel.sounds).toEqual([
      'steel-chair.hit', 'steel-chair.settle-1', 'steel-chair.settle-2', 'steel-chair.settle-3', 'steel-chair.settle-4',
      'steel-chair.can-settle-1', 'steel-chair.can-settle-2',
      'steel-chair.ladder-settle-1', 'steel-chair.ladder-settle-2',
      'steel-chair.extinguisher-hit', 'steel-chair.extinguisher-settle-1', 'steel-chair.extinguisher-settle-2', 'steel-chair.extinguisher-hiss',
    ]);
    /* Every steel-chair slot the instance's sounds hold is one the card names, and it names no other. */
    expect([...steel.sounds!].sort()).toEqual(sounds.slots.map((s) => s.key).filter((k) => k.startsWith('steel-chair.')).sort());
    const laugh = instanceUi.cards.find((c) => c.key === 'laugh-track')!;
    expect(laugh.sounds).toEqual([
      'laugh-track.laugh-1', 'laugh-track.laugh-2', 'laugh-track.laugh-3',
      'laugh-track.cheer-1', 'laugh-track.cheer-2', 'laugh-track.cheer-3',
      'laugh-track.boo-1', 'laugh-track.boo-2', 'laugh-track.boo-3',
      'laugh-track.titter', 'laugh-track.ooh', 'laugh-track.grumble',
    ]);
  });
  /* postcard.css writes the play tag's words 8% toward white (color-mix in sRGB), which is rounded per channel here. */
  const playTagInk = (hex: string) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.92 + 255 * 0.08).toString(16).padStart(2, '0')).join('')}`;
  /* The small words on a face (the alignment tag in the card's ink on its color, the play's tag in its color on the card's ground) are 11px at the
     fan's size, so each pair meets 4.5:1. A card armed and not yet played shows over the page with nothing masking it, and axe reads it there. */
  test('every card face\'s tag and play tag meet 4.5:1 at the fan size', () => {
    const grounds = Object.entries((instanceUi.glass as unknown as { keys: Record<string, Record<string, { value: string }>> }).keys)
      .map(([key, tokens]) => [key, tokens['--kb-glass-card']?.value] as const);
    expect(grounds.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const c of instanceUi.cards) {
      const inkOnColor = ratio(c.art.ink, c.art.color);
      if (inkOnColor < 4.5) failures.push(`${c.key}: tag ink ${c.art.ink} on ${c.art.color} is ${inkOnColor.toFixed(2)}:1`);
      for (const [key, ground] of grounds) {
        if (!ground) { failures.push(`${key}: --kb-glass-card is not set`); continue; }
        const colorOnGround = ratio(playTagInk(c.art.color), ground);
        if (colorOnGround < 4.5) failures.push(`${c.key}: play tag ${c.art.color} on ${key}'s ${ground} is ${colorOnGround.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });
  test('Laugh Track has its face, its machine slot and its rules in words true to the card and the settings', () => {
    const ui = instanceUi.cards.find((c) => c.key === 'laugh-track')!;
    expect(ui.art.color).toBe('#d24a2c');
    expect(ui.art.ink).toBe('#0d0301');
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
    const post = (text: string) => ({ reach: 'post', act: 'p1', kind: 'post', length: text.length, text, links: [] } as never);
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
    const priceAt = (places: number) => laughTrack.playPrice!(instance.settings, post('abcd '.repeat(places)), config, []);
    expect(priceAt(free)).toBe(0);
    expect(priceAt(free + 1)).toBe(e['laughTrack.perPlace']);
    expect(priceAt(free + 2)).toBeGreaterThan(priceAt(free + 1));
    expect(priceAt(30)).toBe(e['laughTrack.mostAdded']);
    expect(laughTrack.rarity).toBe('uncommon');
    expect(laughTrack.alignment).toBe('pepperoni');
    expect(laughTrack.setPhrase!({ cues: [{ phrase: 'first one', sound: 'boo' }, { phrase: 'second', sound: 'cheer' }] })).toBe('first one');
    const at = instance.machine.findIndex((m) => 'card' in m.item && m.item.card === 'laugh-track');
    expect(instance.machine[at]).toEqual({ item: { card: 'laugh-track' }, availability: 'hidden', price: 150 });
    // The machine's rule (machine.test.ts) hides every uncommon, so Laugh Track is not drawn: the commons are the only cards on sale.
    expect(instance.machine.filter((m) => 'card' in m.item && m.availability === 'onSale').every((m) => instance.cards.find((c) => c.key === (m.item as { card: string }).card)!.rarity === 'common')).toBe(true);
  });
  test('THIS has its face, its words and its handwriting, each the plan\'s, and its numbers are the rules\'', () => {
    const ui = instanceUi.cards.find((c) => c.key === 'this')!;
    expect(ui.art.color).toBe('#d24a2c');
    expect(ui.art.ink).toBe('#0d0301');
    expect(ui.art.tagline).toBe('Point at it.');
    expect(ui.summary).toBe('Point at a line of a post and say something about it.');
    expect(ui.status).toBe('Notes on its words');
    expect(ui.hint).toBe('Someone pointed at these words. The Lens says who.');
    expect(ui.Effect).toBeDefined();
    expect(ui.ConfigForm).toBeDefined();
    expect(ui.logPlay!({ phrase: 'the same old', words: 'again' }, {} as never)).toBe('It pointed at “the same old” and wrote “THIS again”.');
    expect(ui.logPlay!({ phrase: 'the same old', words: '' }, {} as never)).toBe('It pointed at “the same old” and wrote “THIS”.');
    const said = ui.describe(instance.settings);
    expect(said).toBe(`A Pepperoni card, ${thisCard.rarity}. You choose words in a post, and the post gets a note under them: THIS, an arrow, and up to ${THIS_WORDS.most} characters of your own after it, or none. The note names nobody; the Lens says who played it. Up to ${thisCard.stack} fit on a post, and they stay. If the author edits the words out, the note moves to the foot of the post and quotes them. You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on the quoting post at no further cost, using up the card. A set one lands only when the quote's own words hold its phrase. It costs nothing more to play than its price at the machine.`);
    expect(THIS_WORDS.most).toBe(60);
    expect(thisCard.stack).toBe(3);
  });
  test('Hot Box has its face, its words and its log line, each the plan\'s, and its span is the rules\'', () => {
    const ui = instanceUi.cards.find((c) => c.key === 'hot-box')!;
    expect(ui).toBeDefined();
    expect(ui.art.color).toBe('#ff3d7f');
    expect(ui.art.ink).toBe('#14030a');
    expect(ui.art.tagline).toBe('Smoke out a post.');
    expect(ui.summary).toBe('Fills a post with smoke in your color. Readers wave it away to read, and it rolls back in.');
    expect(ui.status).toBe('Smoke on this post');
    expect(ui.hint).toBe('Point at the words to part the smoke.');
    expect(ui.Effect).toBeDefined();
    expect(ui.ConfigForm).toBeDefined();
    expect(ui.describe(instance.settings)).toBe(`A Salty card, ${hotBox.rarity}. It fills a post with smoke in the color you choose. Under the smoke the words can't be read: a reader points at them to clear a patch, or holds Wave the smoke to clear the post line by line, and the smoke rolls back in. It is the same for every reader, the post's author and you included. It lasts ${spanWords(HOT_BOX_THINS)}, thinning as it goes, then clears by itself. One fits on a post at a time. ${setMoveWords('the quoting post')} It costs nothing more to play.`);
    expect(ui.describe(instance.settings)).toContain('It lasts 3 days, thinning');
    expect(ui.logPlay!({ color: '#19e3ff' }, {} as never)).toBe('It smoked the post in cyan.');
    expect(ui.logPlay!({ color: 'not a color' }, {} as never)).toBeUndefined();
  });
  test('THIS\'s handwriting is vendored with its license, and its stylesheet names no font outside its own folder', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'this');
    const font = fs.readFileSync(path.join(dir, 'fonts', 'PermanentMarker-Regular.woff2'));
    expect(font.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(font.length).toBeGreaterThan(5_000);
    expect(fs.readFileSync(path.join(dir, 'fonts', 'LICENSE.txt'), 'utf8')).toMatch(/Apache License\s+Version 2\.0/u);
    const css = fs.readFileSync(path.join(dir, 'this.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gu)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u, u).toMatch(/^\.\/fonts\/[\w.-]+\.woff2$/u);
    expect(css).toMatch(/font-display:\s*block/u);
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
    expect(said).toContain("Any reader can lift a strip by one end to read under it, and it lays back down. Only the post's author can peel strips off, slowly, for everyone and press a started peel back down, and the author's words are always under the tape and in the post's History. The author can't peel any of a play's tape for the first 24 hours after it lands.");
    expect(said).toContain('0.25 more for every 50 characters it covers');
    expect(ac.describe({ ...instance.settings, economy: { ...instance.settings.economy, 'autocorrect.holdHours': 0 } })).not.toContain("can't peel any");
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
  test('the three lines of the author and the caster\'s length are said whole, from the instance\'s own words', () => {
    const at = '2026-11-09T10:00:00.000Z';
    const act = (id: string, kind: Act['kind'], character: string, over: Partial<Act> = {}): Act =>
      ({ id, kind, character, thread: 'th', targetActId: null, seq: null, createdAt: at, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over });
    const post = act('post1', 'post', 'me', { seq: 1 });
    const play = act('k1', 'card', 'them', { targetActId: 'post1', payload: { card: 'you-were-saying', config: { steps: 3 }, tokens: 175 } });
    const log: Log = { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet: [], cards: [{ card: 'you-were-saying', kind: 'played', act: 'k1', price: 75, at }], packs: [], playsOnMine: [],
      writes: [{ play: 'k1', post: 'post1', version: 'post1', failed: false, opening: true, over: false, at }, { play: 'k1', post: 'post1', version: 'e1', failed: false, opening: false, over: false, at }, { play: 'k1', post: 'post1', version: 'e2', failed: true, opening: false, over: true, at }],
      saves: [{ play: 'k1', post: 'post1', savedAt: at }], setEnds: [], caught: [], ended: [], cosmetics: [], falls: [], before: null };
    const mine = [{ id: 'me', name: 'Pipewrench', pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: at, classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: at, retiredAt: null, pendingTurn: null, presenceHidden: false }, { ...{ id: 'them', name: 'Spritey' }, pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: at, classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: at, retiredAt: null, pendingTurn: null, presenceHidden: false }];
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
    const log: Log = { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet: [], cards: [], packs: [], playsOnMine: [], writes: [], saves: [{ play: 'k1', post: 'post1', savedAt: at }], setEnds: [], caught: [], ended: [], cosmetics: [], falls: [], before: null };
    const mine = [{ id: 'me', name: 'Pipewrench', pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: at, classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: at, retiredAt: null, pendingTurn: null, presenceHidden: false }];
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
  test('the Face\'s stolen thunder says when it is not charged: a booed post, or a card that answered a Salty play', () => {
    expect(instanceUi.reasonWords('face.stoleThunder', instance.settings.economy)).toBe('Stole the thunder: a card the character played on another\'s post drew more votes than the post this window. Not charged where the post\'s reactions are mostly negative, or where the card answered a Salty play');
    expect(instanceUi.classLooks.face!.hurtsBy(instance.settings.economy, instance.settings.settlementLength)).toBe('Hurt by bored reactions, and by stealing a non-Salty post\'s thunder.');
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
      'jabroni.drewTheGroan', 'jabroni.soldTheL', 'jabroni.takenSincerely', 'lurker.calledIt', 'lurker.misread', 'reveal.perk', 'crowd.floor', 'lurker.spunAThread', 'lurker.cardDrew', 'lurker.postedTooMuch',
      'technician.respected', 'technician.evergreen', 'technician.draggedIn',
      'tweener.splitTheRoom', 'tweener.stirredThePot', 'tweener.shrugged', 'tweener.litTheFuse', 'tweener.outvoted'];
    for (const r of reasons) expect(instanceUi.reasonWords(r, instance.settings.economy), r).not.toMatch(/^Settled under/);
  });
  test('every loss a class charges is one the cushion can read, or is named here', () => {
    const s = instance.settings;
    const eco = (k: string) => economyOf(s, k);
    const DAY = 86_400_000;
    const days = eco('technician.evergreenDays');
    const none = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
    const hype = { ...none, excitedPositive: 1 };
    const heat = { ...none, excitedNegative: 1 };
    /* A vote of +1 and one of -1 in each quadrant, on a post aged past Evergreen and on a card. */
    const received = QUADRANTS.flatMap((quadrant) => [1, -1].flatMap((votes) => [
      { act: 'p1', actKind: 'post' as const, quadrant, at: 10 * DAY, actAt: 0, kind: 'reaction', votes },
      { act: 'k1', actKind: 'card' as const, quadrant, at: 10 * DAY, actAt: 9 * DAY, kind: 'reaction', votes },
    ]));
    /* Sweet, Salty and Pepperoni cards that outdraw a post of another player's that the room cheered, each with what it drew after it. */
    const played = (alignment: 'sweet' | 'salty' | 'pepperoni', act: string) => ({
      act, card: 'whoops', alignment, readsAs: alignment, at: 5, target: 'p9', onOthers: true, votes: 3, targetVotes: 1, targetLean: 1,
      targetAfter: { ...none, excitedPositive: 2 }, drawnAfter: { at: 6, now: [hype, heat] },
    });
    const i: ClassInput = {
      character: 'c', from: 0, to: 20 * DAY, received, given: [],
      /* A spark that crosses in the window, and one that paid before it whose calm votes moved away in it, so its refund is taken back. */
      debates: [
        { act: 'p1', at: 0, posts: [1, 2, 1, 2, 3].map((voice, n) => ({ at: n + 1, voice })), inOwnDebate: false, standing: { before: [], now: [] }, cushioned: 0, paid: {}, placed: true },
        { act: 'p2', at: -DAY, posts: [1, 2, 1, 2, 3].map((voice, n) => ({ at: n + 1 - DAY, voice })), inOwnDebate: false,
          standing: { before: [{ ...none, calmPositive: 1 }, { ...none, calmPositive: 1 }], now: [] }, cushioned: 0, paid: { 'tweener.litTheFuse': 20, 'tweener.outvoted': 10 }, placed: true },
      ],
      posts: Array.from({ length: eco('lurker.postsAllowed') + 1 }, (_, n) => ({ act: `q${n}`, at: n })),
      held: [{ act: 'p9', quadrant: 'excitedPositive', at: 5, reactedAt: 4, share: 1, rank: 1, othersBefore: 0, othersNow: eco('lurker.crowd'), endsUp: 'excitedPositive' },
        { act: 'p8', quadrant: 'excitedPositive', at: 5, reactedAt: 4, share: 1, rank: 1, othersBefore: 0, othersNow: eco('lurker.crowd'), endsUp: 'boredNegative' }],
      cardsPlayed: [played('sweet', 'k1'), played('salty', 'k2'), played('pepperoni', 'k3')],
      cardsLanded: [{ act: 'k4', card: 'whoops', alignment: 'salty', readsAs: 'salty', at: 5, on: 'p1' }],
      threadsSpun: [{ act: 'p9', thread: 't1', at: 5, fromOthers: true, repliersBefore: 0, repliersNow: eco('lurker.spunThreadRepliers') }],
      standings: [
        { act: 'p1', actKind: 'post', at: 5, before: [hype], now: [hype, heat] },
        { act: 'p2', actKind: 'post', at: 5, before: [hype, heat], now: [hype] },
      ],
    };
    /* Losses no reaction's vote can be read from, with why: the cushion softens a loss from a reaction and a window's loss, and nothing else. */
    const named: Record<string, string> = {
      'lurker.postedTooMuch': 'no reaction causes it; the sheet says nothing lost for any other reason is given back',
      'lurker.misread': 'a call that missed, charged for where the post ended up; no reaction\'s vote lost it',
      'tweener.splitTheRoom': 'a gain taken back as the room stops being split',
      'tweener.outvoted': 'a refund taken back as a calm or bored vote moves away; the shrug it answered was the loss, and the cushion read that',
    };
    const seen = new Set<string>();
    const seenNegative = new Set<string>();
    const unread: string[] = [];
    for (const rules of instance.classes) {
      for (const e of rules.earn(i, s)) {
        seen.add(e.reason);
        if (e.amount >= 0) continue;
        seenNegative.add(e.reason);
        const fromAReaction = (e.votes ?? 0) > 0 && e.at !== undefined;
        const ofAWindow = e.ofWindow === true && e.act !== undefined;
        const gainTakenBack = (e.votes ?? 0) < 0;
        if (!fromAReaction && !ofAWindow && !gainTakenBack && !(e.reason in named)) unread.push(e.reason);
      }
    }
    expect([...new Set(unread)].sort(), 'a loss the cushion cannot read, and no reason named here').toEqual([]);
    expect(Object.keys(named).filter((r) => !seenNegative.has(r)).sort(), 'a reason named here that no class charges any more').toEqual([]);
    const classKeys = instance.classes.map((c) => c.key);
    const own = REASON_KEYS.filter((r) => classKeys.some((k) => r.startsWith(`${k}.`)));
    expect([...seen].sort(), 'the reasons the input reached, against the reasons the classes can give').toEqual([...own].sort());
  });
  test('a card\'s boost names the card it came from, by the key the settlement wrote, and says nothing of a card it cannot find', () => {
    expect(REASON_KEYS).toContain('card.boost');
    for (const card of instance.cards.filter((c) => c.gimmick?.kind === 'earn')) expect(instanceUi.reasonWords('card.boost', { card: card.key })).toBe(`${card.name} added: what the card's boost on a reaction earned`);
    expect(instanceUi.reasonWords('card.boost', {})).toMatch(/^A card added:/u);
    expect(instanceUi.reasonWords('card.boost', { card: 'gone' })).toMatch(/^A card added:/u);
  });
  test('a flat boost says its size from the entry, a boost with a share or with none keeps its words, and a cushion says its share as a fraction', () => {
    expect(instanceUi.reasonWords('card.boost', { card: 'heat-magnet', flat: 0.75 })).toBe('Heat Magnet: up to three quarters of a vote more for each vote it named, from players who first reacted while it was up');
    expect(instanceUi.reasonWords('card.boost', { card: 'hype-up', flat: 1 })).toBe('Hype-Up: up to a vote more for each vote it named, from players who first reacted while it was up');
    expect(instanceUi.reasonWords('card.boost', { card: 'publicity-tour', flat: 0.5 })).toBe('Publicity Tour: up to half a vote more for each vote it named, from players who first reacted while it was up');
    expect(instanceUi.reasonWords('card.boost', { card: 'publicity-tour', by: 0.2 })).toBe("Publicity Tour added: what the card's boost on a reaction earned");
    expect(instanceUi.reasonWords('card.boost', { card: 'publicity-tour' })).toBe("Publicity Tour added: what the card's boost on a reaction earned");
    expect(instanceUi.reasonWords('card.boost', { card: 'gone', flat: 0.5 })).toBe('A card: up to half a vote more for each vote it named, from players who first reacted while it was up');
    /* A line that takes pay back (its amount is below zero) has words of its own; one that pays, or whose amount is not given, keeps the paying words. */
    expect(instanceUi.reasonWords('card.boost', { card: 'heat-magnet', flat: 0.75 }, -38)).toBe('Heat Magnet: up to three quarters of a vote taken back for each vote it named that later moved away');
    expect(instanceUi.reasonWords('card.boost', { card: 'hype-up', flat: 1 }, -1)).toBe('Hype-Up: up to a vote taken back for each vote it named that later moved away');
    expect(instanceUi.reasonWords('card.boost', { card: 'gone', flat: 0.5 }, -25)).toBe('A card: up to half a vote taken back for each vote it named that later moved away');
    expect(instanceUi.reasonWords('card.boost', { card: 'heat-magnet', flat: 0.75 }, 38)).toBe('Heat Magnet: up to three quarters of a vote more for each vote it named, from players who first reacted while it was up');
    expect(instanceUi.reasonWords('card.boost', { card: 'heat-magnet', flat: 0.75 }, 0)).toBe('Heat Magnet: up to three quarters of a vote more for each vote it named, from players who first reacted while it was up');
    expect(REASON_KEYS).toContain('card.cushion');
    expect(instanceUi.reasonWords('card.cushion', { card: 'gone', share: 0.5 })).toBe('A card: half of each loss from a reaction, given back');
    expect(instanceUi.reasonWords('card.cushion', { share: 0.5 })).toBe('A card: half of each loss from a reaction, given back');
    expect(instanceUi.reasonWords('card.cushion', { card: 'heat-magnet', share: 0.75 })).toBe('Heat Magnet: three quarters of each loss from a reaction, given back');
    expect(instanceUi.reasonWords('card.cushion', { card: 'heat-magnet', share: 1 })).toBe('Heat Magnet: all of each loss from a reaction, given back');
    expect(instanceUi.reasonWords('card.cushion', { card: 'heat-magnet' })).toBe('Heat Magnet: part of each loss from a reaction, given back');
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
    log: { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet, cards: [], packs: [], playsOnMine: [], writes: [], saves: [], setEnds: [], caught: [], ended: [], cosmetics: [], falls: [], before: null, ...over },
    mine: [], estimate: null, standings: {}, season: null, turns: [], nextSettlement: null, acts: new Map(), names: new Map(), titles: new Map(), states: new Map(),
  }, { instance, ui: instanceUi, postsPerPage: 20, economy: {}, now: Date.parse('2026-10-29T12:00:00.000Z') }, 600, null);
  const said = (r: { details: readonly unknown[] }) => r.details.map((d) => (typeof d === 'string' ? d : (d as { text: string }).text)).join('');
  const purchase = (price: number, balanceAfter: number): Log['wallet'][number] => ({ settlement: null, kind: 'purchase', change: -price, overflow: 0, floored: 0, balanceAfter, ref: null, at });

  test('five pulled rows and their purchase read as one line, in pull order, with the price and the wallet', () => {
    const rows = lines({ cards: pulled, packs: [{ pack: 'pk1', kind: 'booster', price: 300, repriced: false, contents, at, source: 'bought' as const, openedAt: at }] }, [purchase(300, 1200)]);
    expect(rows.map((r) => r.kind)).toEqual(['pack']);
    expect(rows[0]!.what).toBe('You bought a Booster');
    expect(said(rows[0]!)).toBe('Whoops!, Glitter Bomb, Feelin\' Fab, Stick Around and Card Collector. From the Vending Machine, for 3.00.');
    expect([rows[0]!.aura, rows[0]!.wallet]).toEqual([-300, 1200]);
  });
  test('a purchase at a price the Boss moved says so, for a pack and for a card', () => {
    const pack = lines({ cards: pulled, packs: [{ pack: 'pk1', kind: 'booster', price: 450, repriced: true, contents, at, source: 'bought' as const, openedAt: at }] }, [purchase(450, 1050)]);
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
      packs: [{ pack: 'pk1', kind: 'booster', price: 300, repriced: false, contents, at, source: 'bought' as const, openedAt: at }, { pack: 'pk2', kind: 'booster', price: 300, repriced: false, contents: second, at, source: 'bought' as const, openedAt: at }],
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
      ['sugar-coat', '#2ee6ff', '#03141a', 'Only Sweet cards land on your post.'], ['hype-up', '#2ee6ff', '#03141a', 'Give a post a push.'],
      ['last-word', '#ff3d7f', '#14030a', 'Stop quotes of your post.'],
    ] as const) {
      expect([ui(key).art.color, ui(key).art.ink, ui(key).art.tagline], key).toEqual([color, ink, tagline]);
      expect(ui(key).art.canvas, key).toMatch(/\.webp$/u);
      expect(typeof ui(key).status === 'string' ? (ui(key).status as string).split(' ').length : 0, key).toBeLessThanOrEqual(6);
    }
    expect(ui('sugar-coat').summary).toBe('Used on your post. Turns away Salty and Pepperoni cards for a week.');
    expect(ui('hype-up').summary).toBe('Cast on a post. For 3 days, each positive vote on it pays its author a vote more.');
    expect(ui('hype-up').status).toBe('Earns more from positive votes');
    expect(ui('last-word').summary).toBe('Used on your post. Nobody can quote it for a week.');
    const sugarWords = ui('sugar-coat').describe!({} as never);
    expect(sugarWords).toContain('It does not stop a card from being set face down there.');
    expect(sugarWords).not.toContain('It never stops a card set face down.');
    expect(ui('hype-up').logPlay!({}, {})).toBe('Each positive vote on that post pays its author up to a vote more until it ends.');
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
      ['tattle-tale', '#ff3d7f', '#14030a', 'Point the Mod Bots at someone.', "A Tattle-Tale: Mod Bot patrols weigh this character's posts double."],
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
      "Cast on a character. For a week, Mod Bot patrols weigh that character's posts double when picking what to look at.",
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

  test('"double" is said only while the rules\' weight is 2', () => {
    expect(tattleTale.discipline).toEqual({ kind: 'watch', weight: 2 });
    expect(ui('tattle-tale')?.summary).toContain('weigh that character\'s posts double when picking');
    expect(ui('tattle-tale')?.describe(instance.settings)).toContain("that character's posts count double in the draw, so they are more likely to be picked");
    retuned(tattleTale, 'discipline', { kind: 'watch', weight: 3 }, () => {
      expect(ui('tattle-tale')?.describe(instance.settings)).toContain("that character's posts count 3 times over in the draw, so they are more likely to be picked");
      expect(ui('tattle-tale')?.describe(instance.settings)).not.toContain('double');
      expect(ui('tattle-tale')?.describe(instance.settings)).not.toContain('as likely');
    });
  });

  test('each rules\' words are the plan\'s, true at Divided World\'s settings, and read their numbers from the rules and the settings', () => {
    const say = (k: string, s = instance.settings) => ui(k)!.describe(s);
    expect(say('happy-heart')).toBe(`A Sweet card, ${rules('happy-heart').rarity}, cast from any post by the character it lands on. It takes the oldest 2 warn points off that character's warn bar at once, as many as the lightest breach lands, or as many as are left. The filings stay on the record; the card is a new entry beside them. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.`);
    expect(say('super-happy-heart')).toBe(`A Sweet card, ${rules('super-happy-heart').rarity}, cast from any post by the character it lands on. It takes every point off that character's warn bar at once. The filings stay on the record; the card is a new entry beside them. If the bar is empty the play is refused and you keep the card. Any character can play it on any player's character, one of your own included. It is always cast face up. It costs nothing more to play.`);
    expect(say('ultra-happy-heart')).toBe(`A Sweet card, ${rules('ultra-happy-heart').rarity}, cast from any post by a banned character. It ends that character's ban at once: the character can post, react and play cards again from that moment. The ban stays on the record and still counts toward how long that character's next ban is this season, and the warn bar is not touched. If the character is not banned the play is refused and you keep the card. A banned character cannot play cards, so another character plays it: anyone's, one of your own included. It is always cast face up. It costs nothing more to play.`);
    expect(say('take-the-fall')).toBe(`A Sweet card, ${rules('take-the-fall').rarity}, cast face up on a post by another character. The next time a Mod Bot's visit to that post files, its warn points land on the character that played this card instead of the post's author, and a ban they bring is that character's too. Only the points and the ban move: the post keeps its notice. One fits on a post. It waits until a visit files, the first filing uses it up, and it can be played while a visit is open. The character that took the fall can appeal the filing. It costs nothing more to play.`);
    expect(say('tattle-tale')).toBe(`A Salty card, ${tattleTale.rarity}, cast from any post by the character it lands on. For a week, when a Mod Bot's patrol picks which recent posts to look at, that character's posts count double in the draw, so they are more likely to be picked. It makes a look likelier, never a ruling: the Mod Bot still judges each post against the rules, and a patrol still drops a finding against a character staff has already punished 3 times in the last 7 days. One fits on a character at a time, and it ends by itself. It is always cast face up. It costs nothing more to play.`);
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
  /* Every .svg of an item's folder (gear/<key>/<view>.svg), or of the trophies folder, by its path under ui/. */
  const files = (kind: 'gear' | 'trophies') => (kind === 'trophies'
    ? fs.readdirSync(path.join(dir, kind)).filter((f) => f.endsWith('.svg')).map((f) => [`${kind}/${f}`, fs.readFileSync(path.join(dir, kind, f), 'utf8')] as const)
    : fs.readdirSync(path.join(dir, kind), { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => fs.readdirSync(path.join(dir, kind, e.name)).filter((f) => f.endsWith('.svg')).map((f) => [`${kind}/${e.name}/${f}`, fs.readFileSync(path.join(dir, kind, e.name, f), 'utf8')] as const)));

  test('gearOf throws at build time when views.json and the imported pictures disagree', () => {
    const shape = { width: 10, height: 10, pivot: { x: 5, y: 5 } };
    expect(gearOf({ default: 'front', views: { front: shape } }, { front: 'a.svg' }).views.front?.art).toBe('a.svg');
    expect(() => gearOf({ default: 'front', views: { front: shape } }, {})).toThrow(/no picture/u);
    expect(() => gearOf({ default: 'back', views: { front: shape } }, { front: 'a.svg' })).toThrow(/default/u);
    expect(() => gearOf({ default: 'front', views: { front: shape } }, { front: 'a.svg', back: 'b.svg' })).toThrow(/back/u);
  });

  test('each view\'s views.json size is its picture\'s own size: a WebP\'s header, an SVG\'s viewBox', () => {
    let webps = 0;
    let svgs = 0;
    for (const key of Object.keys(gearUi)) {
      const shipped = JSON.parse(fs.readFileSync(path.join(dir, 'gear', key, 'views.json'), 'utf8')) as { views: Record<string, { width: number; height: number }> };
      for (const [view, size] of Object.entries(shipped.views)) {
        const webp = path.join(dir, 'gear', key, `${view}.webp`);
        const svg = path.join(dir, 'gear', key, `${view}.svg`);
        expect(fs.existsSync(webp) || fs.existsSync(svg), `${key}/${view} has no picture`).toBe(true);
        if (fs.existsSync(webp)) {
          const info = webpInfo(fs.readFileSync(webp));
          expect('fault' in info ? info.fault : null, `${key}/${view}.webp`).toBeNull();
          expect([size.width, size.height], `${key}/${view}.webp`).toEqual('fault' in info ? [] : [info.width, info.height]);
          webps++;
        } else {
          const box = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/u.exec(fs.readFileSync(svg, 'utf8'));
          expect(box, `${key}/${view}`).not.toBeNull();
          expect([size.width, size.height], `${key}/${view}`).toEqual([Number(box![1]), Number(box![2])]);
          svgs++;
        }
      }
    }
    expect(webps, 'the ten caps and the Nostalgic Hat ship five WebP views each').toBe(55);
    expect(svgs, 'the three placeholders ship one SVG each').toBe(3);
    expect(fs.readdirSync(path.join(dir, 'gear')).filter((f) => f.endsWith('.svg')), 'no flat file of the old layout is left').toEqual([]);
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

describe('Mooch, Toll, 4D Chess, Off Day and Rope Break in plain words (card notes Part 6, Task 9)', () => {
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
      ['mooch', '#ff3d7f', '#14030a', 'Ride a post\'s reactions.'], ['toll', '#d24a2c', '#0d0301', 'Get paid when a Move lands here.'],
      ['4d-chess', '#ff3d7f', '#14030a', 'Get paid for the Move you saw coming.'], ['off-day', '#ff3d7f', '#14030a', 'Give a character somebody else\'s day.'],
    ] as const) {
      expect([ui(key).art.color, ui(key).art.ink, ui(key).art.tagline], key).toEqual([color, ink, tagline]);
      expect(ui(key).art.canvas, key).toMatch(/\.webp$/u);
      expect(ui(key).art.mark, key).toMatch(/\.svg$|^data:image\/svg\+xml/u);
    }
    expect(ui('mooch').summary).toBe('Names one kind of reaction on a post. For a week, each new vote the post draws there pays you a little, and costs its author nothing.');
    expect(ui('toll').summary).toBe('Used on your post. For a week, every reaction to a Move another player casts there pays you too.');
    expect(ui('4d-chess').summary).toBe('Set face down on your post, naming a Move up to uncommon and a reaction. If that Move lands there, those reactions pay you.');
    expect(ui('off-day').summary).toBe('Cast on a character, naming a class. From the next settlement to the one after, that character scores as that class.');
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

  test('Whoopee Cushion is a face-down Reversal with every one\'s status, Pepperoni\'s colors, no form and no effect, and its words say what springs it and what it pays', () => {
    const cushion = ui('whoopee-cushion');
    expect(cushion.status).toBe(ui('rope-break').status);
    expect(cushion.status).toBe('Set, face down to everyone else');
    expect(cushion.art.color).toBe('#d24a2c');
    expect(cushion.art.ink).toBe('#0d0301');
    expect(cushion.art.tagline).toBe('Get paid when a common card lands.');
    expect(cushion.summary).toBe('Set face down on your post. The first common cast there lands, and every reaction to it pays you a quarter of a vote.');
    expect(cushion.Effect).toBeUndefined();
    expect(cushion.ConfigForm).toBeUndefined();
    expect(cushion.describe(instance.settings)).toBe(`A Pepperoni card, ${whoopeeCushion.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first common card cast on that post, of any flavor, springs it and shows it: that card lands as usual and its caster keeps everything it earns, and from then on each vote it draws, of any kind, pays you a quarter of a vote. A card cast by one of your own characters springs it and pays you nothing. A rarer card passes over it, and a card your post's ward turns away never reaches it. It springs once, or comes back to your hand after 7 days if nothing springs it. It costs nothing more to set.`);
  });

  test('Rope Break is a face-down Reversal with the same status as every one, its Sweet colors, no form and no effect, and its words say what it catches', () => {
    const rope = ui('rope-break');
    expect(rope.status).toBe('Set, face down to everyone else');
    expect(rope.status).toBe(ui('card-collector').status);
    expect(rope.art.color).toBe('#2ee6ff');
    expect(rope.art.ink).toBe('#03141a');
    expect(rope.art.tagline).toBe('Catch a Salty Move.');
    expect(rope.summary).toBe('Set face down on your post. The first common Salty Move played on it is caught: it does nothing, and the card goes to your hand.');
    expect(rope.Effect).toBeUndefined();
    expect(rope.ConfigForm).toBeUndefined();
    const said = rope.describe(instance.settings);
    expect(said).toBe(`A Sweet card, ${ropeBreak.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first common Salty Move played on that post is caught: it lands as caught and does nothing, and you take it into your hand. Any other card passes over it, and a card your post's ward turns away never reaches it. It springs once, or ends by itself after 7 days. It costs nothing more to set.`);
    expect(said).not.toContain('names');
    expect(rope.describe({ ...instance.settings, setLasts: { unit: 'day', count: 1 } })).toContain('after 1 day.');
  });

  test('Pay It Forward is a face-down Reversal with every one\'s status, Sweet\'s colors, no form and no effect, and its words say what springs it and what goes back', () => {
    const pay = ui('pay-it-forward');
    expect(pay.status).toBe(ui('rope-break').status);
    expect(pay.status).toBe('Set, face down to everyone else');
    expect([pay.art.color, pay.art.ink]).toEqual([ui('rope-break').art.color, ui('rope-break').art.ink]);
    expect(pay.art.tagline).toBe('Give a Sweet Move back to its player.');
    expect(pay.summary).toBe("Set face down on your post. The first Sweet Move, up to uncommon, played on it lands, and the card goes back to its player's hand.");
    expect(pay.Effect).toBeUndefined();
    expect(pay.ConfigForm).toBeUndefined();
    expect(pay.describe(instance.settings)).toBe(`A Sweet card, ${payItForward.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first Sweet Move, up to uncommon, played on that post springs it and shows it: that Move lands as usual, and the card goes back to its player's hand (the card, not any price paid to play it). A Mod Bot's Move passes over it. A rarer Move passes over it, and a Move your post's ward turns away never reaches it. It springs once, or comes back to your hand after 7 days. It costs nothing more to set.`);
    expect(pay.describe({ ...instance.settings, setLasts: { unit: 'day', count: 1 } })).toContain('after 1 day.');
    /* The flavor and the rarity are the rules'. */
    retuned(payItForward, 'trap', { trigger: { on: 'cast' }, match: { flavors: ['salty'], upTo: 'common' }, outcome: { kind: 'refund' } }, () => {
      expect(pay.describe(instance.settings)).toContain('The first Salty Move, up to common, played on that post');
    });
  });

  test('So Very Happy is a face-down Reversal with every one\'s status, Salty\'s colors, no form and no effect, and its tagline is the glass\'s', () => {
    const svh = ui('so-very-happy');
    expect(svh.status).toBe('Set, face down to everyone else');
    expect([svh.art.color, svh.art.ink]).toEqual([ui('steel-chair').art.color, ui('steel-chair').art.ink]);
    expect(svh.art.tagline).toBe('Play it Sweet or get locked out');
    expect(svh.Effect).toBeUndefined();
    expect(svh.ConfigForm).toBeUndefined();
  });

  test('Kick Me is a Gimmick with Pepperoni\'s colors and an effect, and its words read the earn, the refunds and the span from its rules', () => {
    const kick = ui('kick-me');
    expect([kick.art.color, kick.art.ink]).toEqual([ui('whoopee-cushion').art.color, ui('whoopee-cushion').art.ink]);
    expect(kick.art.tagline).toBe('Earn more when your post bombs.');
    expect(kick.summary).toBe("Used on your post. For 3 days, negative reactions pay 1 vote more, and the first 3 landed Salty Moves go back to their players.");
    expect(kick.status).toBe('Wearing a Kick Me sign');
    expect(kick.Effect).toBeDefined();
    expect(kick.ConfigForm).toBeUndefined();
    expect(kick.logPlay!({}, {})).toBe('Each negative reaction to that post pays one vote more until it ends, and the first three Salty Moves played on it go back to their players.');
    const said = () => kick.describe(instance.settings);
    expect(said()).toBe(`A Pepperoni card, ${kickMe.rarity}, used on one of your own posts. For 3 days a Kick Me sign is taped on it. Each heat or groan vote on that post, from a player of any class, pays its author one vote more. The first three Salty Moves played on that post land as usual, and each card goes back to its player's hand (the card, not any price paid to play it). A Move that a card set face down catches or hands back first, or a Mod Bot's Move, does not count. The sign stays up and keeps paying after the three are used, until it ends. A post carries one at a time. It costs nothing more to use.`);
    retuned(kickMe, 'refunds', { flavors: ['salty'], count: 2 }, () => {
      expect(said()).toContain('The first two Salty Moves played on that post');
      expect(kick.logPlay!({}, {})).toContain('the first two Salty Moves');
    });
    retuned(kickMe, 'gimmick', { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 2 }, () => expect(said()).toContain('pays its author 2 votes more'));
    retuned(kickMe, 'lasts', { unit: 'day', count: 1 }, () => {
      expect(said()).toContain('For a day a Kick Me sign');
    });
  });

  test('Pop Steal is a face-down Reversal with the same status as every one, its Salty colors, no form and no effect, and its words say what it catches', () => {
    const pop = ui('pop-steal');
    expect(pop.status).toBe('Set, face down to everyone else');
    expect(pop.status).toBe(ui('card-collector').status);
    expect(pop.art.color).toBe('#ff3d7f');
    expect(pop.art.ink).toBe('#14030a');
    expect(pop.art.tagline).toBe('Steal a Sweet Move.');
    expect(pop.summary).toBe('Set face down on your post. The first common Sweet Move played on it is caught: it does nothing, and the card goes to your hand.');
    expect(pop.Effect).toBeUndefined();
    expect(pop.ConfigForm).toBeUndefined();
    const said = pop.describe(instance.settings);
    expect(said).toBe(`A Salty card, ${popSteal.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first common Sweet Move played on that post is caught: it lands as caught and does nothing, and you take it into your hand. Any other card passes over it, and a card your post's ward turns away never reaches it. It springs once, or ends by itself after 7 days. It costs nothing more to set.`);
    expect(said).not.toContain('names');
    expect(pop.describe({ ...instance.settings, setLasts: { unit: 'day', count: 1 } })).toContain('after 1 day.');
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
    expect(said('card.ride', 'whoopee-cushion')).toBe('Whoopee Cushion: a quarter of a vote for each vote on the card whose cast sprang it');
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
  const manifest = JSON.parse(fs.readFileSync(path.join(soundsDir, 'sounds.json'), 'utf8')) as { file: string; lufs: number; peak: number }[];
  const manifestFiles = manifest.map((m) => m.file);
  /* The table the design gives, one row per slot, in order. */
  const TABLE: readonly { key: string; file: string; caption: string; ink: string; loop?: true; level?: number }[] = [
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
    { key: 'steel-chair.hit', file: 'steel-chair-hit.mp3', caption: 'A steel chair clangs', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.settle-1', file: 'steel-chair-settle-1.mp3', caption: 'A chair clatters to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.settle-2', file: 'steel-chair-settle-2.mp3', caption: 'A chair clatters to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.settle-3', file: 'steel-chair-settle-3.mp3', caption: 'A chair clatters to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.settle-4', file: 'steel-chair-settle-4.mp3', caption: 'A chair clatters to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.can-settle-1', file: 'steel-chair-can-settle-1.mp3', caption: 'A trash can lid clatters down somewhere', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.can-settle-2', file: 'steel-chair-can-settle-2.mp3', caption: 'A trash can lid clatters down somewhere', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.ladder-settle-1', file: 'steel-chair-ladder-settle-1.mp3', caption: 'A ladder clatters to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.ladder-settle-2', file: 'steel-chair-ladder-settle-2.mp3', caption: 'A ladder clatters to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.extinguisher-hit', file: 'steel-chair-extinguisher-hit.mp3', caption: 'A fire extinguisher thunks', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.extinguisher-settle-1', file: 'steel-chair-extinguisher-settle-1.mp3', caption: 'A fire extinguisher clunks to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.extinguisher-settle-2', file: 'steel-chair-extinguisher-settle-2.mp3', caption: 'A fire extinguisher clunks to the floor', ink: 'var(--kb-salty)' },
    { key: 'steel-chair.extinguisher-hiss', file: 'steel-chair-extinguisher-hiss.mp3', caption: 'A fire extinguisher hisses', ink: 'var(--kb-salty)' },
    { key: 'its-curtains.drumroll', file: 'its-curtains-drumroll.mp3', caption: 'Drumroll', ink: 'var(--kb-pepperoni)', loop: true, level: 0.8 },
    { key: 'its-curtains.crash', file: 'its-curtains-crash.mp3', caption: 'Cymbal crash', ink: 'var(--kb-pepperoni)' },
    { key: 'its-curtains.whoosh', file: 'its-curtains-whoosh.mp3', caption: 'Curtain whooshes open', ink: 'var(--kb-pepperoni)', level: 0.9 },
    { key: 'its-curtains.tada', file: 'its-curtains-tada.mp3', caption: 'Ta-da!', ink: 'var(--kb-pepperoni)', level: 0.9 },
  ];
  const slots = instanceUi.sounds?.slots ?? [];

  test('there are exactly the twenty-nine slots of the designs, in order, with their keys, captions, inks and loops', () => {
    expect(slots.map((s) => s.key)).toEqual(TABLE.map((t) => t.key));
    for (const row of TABLE) {
      const slot = slots.find((s) => s.key === row.key);
      expect(slot, `${row.key} is a slot`).toBeDefined();
      expect(slot!.caption, `${row.key}'s caption`).toBe(row.caption);
      expect(slot!.ink, `${row.key}'s ink`).toBe(row.ink);
      expect(slot!.loop, `${row.key}'s loop`).toEqual(row.loop ? true : undefined);
    }
    expect(slots).toHaveLength(29);
  });
  /* The owner's mix for It's Curtains (2026-11-25): a level is a multiplier on the loudness the manifest brings a sound to. */
  test('every slot\'s gain is its manifest loudness times the level the design gives it', () => {
    for (const row of TABLE) {
      const slot = slots.find((s) => s.key === row.key)!;
      const m = manifest.find((e) => e.file === row.file)!;
      expect(slot.gain, `${row.key}'s gain`).toBeCloseTo(gainOf(m) * (row.level ?? 1), 10);
    }
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
    const target = { reach: 'post', act: 'p1', kind: 'post', length: 2, text: 'hi', links: [] } as const;
    for (const rules of instance.cards) {
      expect(() => landingOn(rules, target, [], { postEffects: 8, cards: instance.cards }), rules.key).not.toThrow();
      expect(() => landingOn(rules, target, [], { postEffects: 8, cards: instance.cards, faceDown: true }), rules.key).not.toThrow();
    }
    expect(landingOn(instance.cards.find((c) => c.key === 'you-were-saying')!, target, [], { postEffects: 8, cards: instance.cards }).ok).toBe(true);
  });
});

describe('Steel Chair in plain words (the Steel Chair plan, Task 6)', () => {
  const chair = instanceUi.cards.find((c) => c.key === 'steel-chair')!;
  /* Known play ids and the objects they roll (ui/steel-chair/objects.ts): play-0 a chair, play-6 a can, play-2 a ladder, play-93 an extinguisher. */
  const playAs = (...ids: string[]): CardPlay[] => ids.map((id) => ({ id, card: 'steel-chair', layer: 1, caster: null, message: '', config: {}, playedAt: '2026-11-15T00:00:00.000Z', post: 'p' }));

  test('it wears the Salty pink and ink, and says what it does in a tagline, a summary and a hint', () => {
    expect(chair.art.color).toBe('#ff3d7f');
    expect(chair.art.ink).toBe('#14030a');
    expect(chair.art.tagline).toBe('Dent a post.');
    expect(chair.summary).toBe('Hits a post with a folding chair and leaves a dent.');
    expect(chair.hint).toBe('Someone took a chair to this post. The Lens says who.');
  });

  test('its status names each play\'s object, counting repeats, one kind after another', () => {
    const status = chair.status as (p: readonly CardPlay[]) => string;
    expect(status(playAs('play-0'))).toBe('Dented by a chair');
    expect(status(playAs('play-0', 'play-1'))).toBe('Dented by 2 chairs');
    expect(status(playAs('play-6'))).toBe('Dented by a trash can');
    expect(status(playAs('play-6', 'play-10'))).toBe('Dented by 2 trash cans');
    expect(status(playAs('play-2'))).toBe('Dented by a ladder');
    expect(status(playAs('play-2', 'play-27'))).toBe('Dented by 2 ladders');
    expect(status(playAs('play-93'))).toBe('Dented by a fire extinguisher');
    expect(status(playAs('play-93', 'play-102'))).toBe('Dented by 2 fire extinguishers');
  });

  test('two kinds join with "and", three with commas and no serial comma, each kind named once in the order its first play appears', () => {
    const status = chair.status as (p: readonly CardPlay[]) => string;
    expect(status(playAs('play-0', 'play-2'))).toBe('Dented by a chair and a ladder');
    expect(status(playAs('play-0', 'play-1', 'play-6'))).toBe('Dented by 2 chairs and a trash can');
    expect(status(playAs('play-2', 'play-0', 'play-6'))).toBe('Dented by a ladder, a chair and a trash can');
    expect(status(playAs('play-0', 'play-2', 'play-6', 'play-93'))).toBe('Dented by a chair, a ladder, a trash can and a fire extinguisher');
    expect(status(playAs('play-6', 'play-0', 'play-1', 'play-93', 'play-6'))).toBe('Dented by 2 trash cans, 2 chairs and a fire extinguisher');
    expect(status(playAs('play-0', 'play-6', 'play-10'))).toBe('Dented by a chair and 2 trash cans');
    expect(status([])).toBe('Dented by a chair');
  });

  test('its words read the stack from its rules', () => {
    expect(chair.describe(instance.settings)).toBe('A Salty card, common. Something is thrown at a post and dents it, usually a folding chair, sometimes a trash can, a step ladder or a fire extinguisher: the words bend into the dent, and the thing drops to the floor under them. A trash can\'s lid flies off, and a fire extinguisher fills the post with spray that clears by itself in a few seconds. Once it lands it covers none of the words, and it holds nobody. It plays again each time the post scrolls into view, somewhere else each time, and with Game sounds on it clangs each time, unless motion is reduced. Up to 3 can stack on one post, each with its own dent, and they stay. You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on the quoting post at no further cost, using up the card. It costs nothing more to play.');
  });

  test('it has an effect and no form', () => {
    expect(chair.Effect).toBeDefined();
    expect(chair.ConfigForm).toBeUndefined();
  });
});

describe('the flat earn cards say their sizes in votes, from their rules', () => {
  const ui = (key: string) => instanceUi.cards.find((c) => c.key === key)!;
  const tail = (key: string) => `whatever its class makes of that ${key === 'class-clown' ? 'reaction' : 'vote'}, and then it stops by itself. It counts votes from players who first react to a post while it is up.${key === 'class-clown' ? " A 😂 counts where it is the first excited, positive reaction its player leaves on that post, and a 🙄 where it is the first bored, negative one. If another excited, positive reaction came first, a later 😂 pays nothing, and the same goes for a 🙄 after another bored, negative one." : ''} Where two cards pay on the same vote, only the larger pays. It costs nothing more to use.`;
  test('Heat Magnet, Publicity Tour and Class Clown', () => {
    const cases: ReadonlyArray<readonly [string, string, string, string, string, string, string]> = [
      ['heat-magnet', 'each negative vote on its posts pays three quarters of a vote more', 'Each negative vote on that character\'s posts pays up to three quarters of a vote more until it ends.', 'A Salty card, uncommon', 'each negative vote (excited or bored) on its posts pays three quarters of a vote more', 'Earn more from negative votes.', 'Earns more from negative votes'],
      ['publicity-tour', 'each positive vote on its posts pays half a vote more', 'Each positive vote on that character\'s posts pays up to half a vote more until it ends.', 'A Sweet card, uncommon', 'each positive vote (excited or calm) on its posts pays half a vote more', 'Earn more from positive votes.', 'Earns more from positive votes'],
      ['class-clown', 'each 😂 and each 🙄 on its posts pays a vote more', 'Each 😂 and each 🙄 on that character\'s posts pays up to a vote more until it ends.', 'A Pepperoni card, uncommon', 'each 😂 and each 🙄 on its posts pays a vote more', 'Earn more from laughs and eye rolls.', 'Earns more from laughs'],
    ];
    for (const [key, sizeSentence, log, lead, earnSentence, tagline, status] of cases) {
      expect(ui(key).art.tagline, key).toBe(tagline);
      expect(ui(key).status, key).toBe(status);
      expect(ui(key).summary, key).toBe(`Used on your own character. For 3 days, ${sizeSentence}.`);
      expect(ui(key).logPlay!({}, {}), key).toBe(log);
      expect(ui(key).describe!(instance.settings), key).toBe(`${lead}, used on your own character, the one playing it. For 3 days, ${earnSentence}, ${tail(key)}`);
    }
  });
  test('Front Row', () => {
    const card = ui('front-row');
    expect(card.art.color).toBe('#d24a2c');
    expect(card.art.ink).toBe('#0d0301');
    expect(card.art.tagline).toBe('Earn more from your cards\' votes.');
    expect(card.summary).toBe('Used on your own character. For 3 days, each vote on a card it plays pays half a vote more.');
    expect(card.status).toBe("Earns more from its cards' votes");
    expect(card.describe!(instance.settings)).toBe('A Pepperoni card, uncommon, used on your own character, the one playing it. For 3 days, each vote on a card that character plays, whatever the reaction, pays half a vote more, and then it stops by itself. A card it plays is a Move it casts, a Gimmick it uses, or a card of its own when it springs. Votes on its posts are not counted. It counts votes from players who first react to the card while it is up. It costs nothing more to use.');
    expect(card.logPlay!({}, {})).toBe('Each vote on a card that character plays pays up to half a vote more until it ends.');
    expect(card.Effect).toBeUndefined();
    expect(card.ConfigForm).toBeUndefined();
    expect(card.hint).toBeUndefined();
  });
  test('Front Row\'s tagline fits the plate: at most two lines of at most 20 characters', () => {
    /* A greedy wrap at spaces; issue #772's check replaces this when it lands. */
    const wrap = (text: string, width: number) => {
      const lines: string[] = [];
      for (const word of text.split(' ')) {
        const last = lines.length - 1;
        if (last >= 0 && lines[last]!.length + 1 + word.length <= width) lines[last] += ` ${word}`;
        else lines.push(word);
      }
      return lines;
    };
    const lines = wrap(ui('front-row').art.tagline!, 20);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
  });
  test('Front Row\'s words hold no "%" and no class\'s name', () => {
    const card = ui('front-row');
    const words = [card.summary, card.status, card.art.tagline, card.describe!(instance.settings), card.logPlay!({}, {})].join(' ').toLowerCase();
    expect(words).not.toMatch(/%/u);
    expect(instance.classes.length).toBeGreaterThan(0);
    for (const c of instance.classes) expect(words, c.name).not.toContain(c.name.toLowerCase());
  });
  test('Hype-Up', () => {
    expect(ui('hype-up').describe!(instance.settings)).toBe(`A Sweet card, common, cast on any post, yours or another's. For 3 days, each positive vote (excited or calm) on that post pays its author a vote more, whatever their class makes of it, and then it stops by itself. It counts votes from players who first react to a post while it is up. A post carries one at a time. It takes nothing from you. Where two cards pay on the same vote, only the larger pays. A Mod Bot earns nothing, so its posts gain nothing from one. You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on the quoting post at no further cost, using up the card. It costs nothing more to play.`);
  });
});

describe('Sweet Heat, the fifth flat earn card, says its size in votes from its rules', () => {
  const sweet = instanceUi.cards.find((c) => c.key === 'sweet-heat')!;

  /* Greedy wrap at spaces, as the plate draws a tagline (issue #772's check replaces this when it lands). */
  const wrap = (text: string, width: number) => {
    const lines: string[] = [];
    for (const word of text.split(' ')) {
      const last = lines[lines.length - 1];
      if (last !== undefined && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  };

  test('its face and its words are the ones the plan gives', () => {
    expect(sweet.art.color).toBe('#d24a2c');
    expect(sweet.art.ink).toBe('#0d0301');
    expect(sweet.art.tagline).toBe('Earn more from excited votes.');
    expect(sweet.summary).toBe('Used on your own character. For 3 days, each excited vote on its posts, positive or negative, pays half a vote more.');
    expect(sweet.status).toBe('Paid more for excited votes');
    expect(sweet.describe!(instance.settings)).toBe('A Pepperoni card, uncommon, used on your own character, the one playing it. For 3 days, each excited vote on its posts, positive or negative, pays half a vote more, whatever its class makes of that vote, and then it stops by itself. It counts votes from players who first react to a post while it is up. Where two cards pay on the same vote, only the larger pays. It costs nothing more to use.');
    expect(sweet.logPlay!({}, {})).toBe("Each excited vote on that character's posts, positive or negative, pays up to half a vote more until it ends.");
    expect(sweet.Effect).toBeUndefined();
    expect(sweet.ConfigForm).toBeUndefined();
  });

  test('its tagline fits the plate: at most two lines of at most 20 characters', () => {
    expect(wrap('Earn more from excited votes.', 20)).toEqual(['Earn more from', 'excited votes.']);
    const lines = wrap(sweet.art.tagline!, 20);
    expect(lines.length, lines.join(' / ')).toBeLessThanOrEqual(2);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(20);
  });

  test('its words hold no "%" and no class\'s name', () => {
    const words = [sweet.summary, sweet.status as string, sweet.describe!(instance.settings), sweet.logPlay!({}, {}), sweet.art.tagline].join('\n');
    expect(words).not.toMatch(/%/u);
    for (const c of instance.classes) expect(words, c.name).not.toMatch(new RegExp(`\\b${c.name}\\b`, 'iu'));
  });
});

describe('Thick Skin in plain words (the Thick Skin plan, Task 3)', () => {
  const skin = instanceUi.cards.find((c) => c.key === 'thick-skin');
  /** The plate's tagline, wrapped greedily at spaces. */
  const wrap = (text: string) => {
    const lines: string[] = [];
    for (const word of text.split(' ')) {
      const last = lines[lines.length - 1];
      if (last !== undefined && last.length + 1 + word.length <= 20) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  };

  test('it wears the Sweet cyan and ink, and says what it does in a tagline, a summary and a status', () => {
    expect(skin, 'thick-skin is listed').toBeDefined();
    expect(skin!.art.color).toBe('#2ee6ff');
    expect(skin!.art.ink).toBe('#03141a');
    expect(skin!.art.tagline).toBe('Lose half as much from reactions.');
    expect(skin!.summary).toBe('Used on your own character. For 3 days, what it loses from reactions is halved.');
    expect(skin!.status).toBe('Loses half as much from reactions');
  });

  test('its words are the ones the rules give', () => {
    expect(skin!.describe(instance.settings)).toBe('A Sweet card, uncommon, used on your own character, the one playing it. For 3 days, whenever a reaction to something that character did costs it Aura, half of that loss is given back, and then it stops by itself. A loss counted from a whole settlement window\'s reactions, and not from one reaction, is halved where this card is still up when that window ends. It changes nothing the character earns, and nothing it loses for any other reason. A card that pays more for the same reaction still pays. It costs nothing more to use.');
    expect(skin!.logPlay!({}, {})).toBe('What that character loses from reactions is halved until it ends.');
  });

  test('its tagline fits the plate: at most two lines of at most 20 characters', () => {
    const lines = wrap(skin!.art.tagline!);
    expect(lines.length, lines.join(' | ')).toBeLessThanOrEqual(2);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(20);
  });

  test('it has no effect and no form, and its words hold no percent and no class name', () => {
    expect(skin!.Effect).toBeUndefined();
    expect(skin!.ConfigForm).toBeUndefined();
    const words = [skin!.art.tagline, skin!.summary, skin!.status as string, skin!.describe(instance.settings), skin!.logPlay!({}, {})].join('\n');
    expect(words).not.toMatch(/%/u);
    expect(instance.classes.length).toBeGreaterThan(0);
    for (const c of instance.classes) expect(words, c.name).not.toMatch(new RegExp(`\\b${c.name}\\b`, 'iu'));
  });

  test('the rules over every card hold with it in', () => {
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
    const keys = cardsUi.map((c) => c.key);
    expect(keys).toContain('thick-skin');
    expect(keys).toEqual([...keys].sort());
  });
});

describe('Cheap Shot in plain words (the Cheap Shot plan, Task 7)', () => {
  const shot = instanceUi.cards.find((c) => c.key === 'cheap-shot');
  const wrap = (text: string) => {
    const lines: string[] = [];
    for (const word of text.split(' ')) {
      const last = lines[lines.length - 1];
      if (last !== undefined && last.length + 1 + word.length <= 20) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  };

  test('it wears the Salty pink and ink, and says what it does in a tagline, a summary and a status', () => {
    expect(shot, 'cheap-shot is listed').toBeDefined();
    expect(shot!.art.color).toBe('#ff3d7f');
    expect(shot!.art.ink).toBe('#14030a');
    expect(shot!.art.tagline).toBe('Your next Move slips past defenses.');
    expect(shot!.summary).toBe("Used on your own character. Its next Move within 3 days can't be turned away or caught by a card up to uncommon.");
    expect(shot!.status).toBe('Lining up a cheap shot');
  });

  test('its words are the ones the rules give', () => {
    expect(shot!.describe(instance.settings)).toBe("A Salty card, uncommon, used on your own character. Its next Move within 3 days gets past any card that would turn it away or catch it, up to uncommon. A card set face down that it gets past stays face down, and only you are told. A card that lets a Move land and pays or gives it back still springs. It does nothing for a Move that lands from a quote. That Move uses it up, whatever was in the way. It costs nothing more to use.");
    expect(shot!.logPlay!({}, {})).toBe("That character's next Move can't be turned away or caught by a card up to uncommon.");
  });

  test('its tagline fits the plate: at most two lines of at most 20 characters', () => {
    const lines = wrap(shot!.art.tagline!);
    expect(lines.length, lines.join(' | ')).toBeLessThanOrEqual(2);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(20);
  });

  test('it has no effect and no form, says "play" and never "cast", and holds no percent and no class name', () => {
    expect(shot!.Effect).toBeUndefined();
    expect(shot!.ConfigForm).toBeUndefined();
    const words = [shot!.art.tagline, shot!.summary, shot!.status as string, shot!.describe(instance.settings), shot!.logPlay!({}, {})].join('\n');
    expect(words).not.toMatch(/%|\bcast/iu);
    /* "face down" is the card's own phrase, not the class Face, so it is set aside before the class check. */
    const unset = words.replace(/face[- ]down/giu, '');
    for (const c of instance.classes) expect(unset, c.name).not.toMatch(new RegExp(`\\b${c.name}\\b`, 'iu'));
  });

  test('the rules over every card hold with it in', () => {
    expect(instanceUiProblems(instanceUi, instance)).toEqual([]);
    const keys = cardsUi.map((c) => c.key);
    expect(keys).toContain('cheap-shot');
    expect(keys).toEqual([...keys].sort());
  });
});
