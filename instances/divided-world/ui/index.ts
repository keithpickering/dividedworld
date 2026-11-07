/**
 * Divided World's look and out-of-character words for the engine's screens, through
 * engine/ui/'s `InstanceUi`. The composition root (web/) is the one place this meets the engine.
 *
 * The quadrant labels, each class's look and description, and the shop's name are placeholders
 * the owner has not yet named (the web plan's brief, item 7); each is marked where it stands.
 */
import type { ClassLook, GlassTheme, InstanceUi } from '../../../engine/ui/types.ts';
import { spanWords } from '../../../engine/ui/characters/format.ts';
import glassData from './glass.json';
import { cardsUi } from './cards.ts';
import theme from './theme.css?url';
import themePreview from './theme.css?preview';
import blueSteel from './themes/blue-steel.css?url';
import blueSteelPreview from './themes/blue-steel.css?preview';
import midnight from './themes/midnight.css?url';
import midnightPreview from './themes/midnight.css?preview';
import hotRod from './themes/hot-rod.css?url';
import hotRodPreview from './themes/hot-rod.css?preview';
import fanSite from './themes/fan-site.css?url';
import fanSitePreview from './themes/fan-site.css?preview';
import coinUrl from './icon/coin.svg?url';
import pipFull from './pips/default-full.svg?url';
import pipEmpty from './pips/default-empty.svg?url';
import gabe from './avatars/gabe.png?url';
import { hintWords } from './hint-words.ts';
import { onboarding } from './onboarding.ts';
import { frontDoor } from './front-door.ts';
import strategyGuide from '../guide/strategy-guide.md?raw';
import { hints } from '../guide/hints.ts';
import { defaults } from '../settings.ts';

/** The font files, as URLs the bundler gives them, by their path under this folder. */
const FONT_URLS = import.meta.glob<string>('./fonts/*.woff2', { query: '?url', import: 'default', eager: true });

/**
 * The glass, from glass.json (the contrast guard reads the same file): each font's `file`, a path
 * under this folder there, becomes the URL the bundler serves it at.
 */
const glass: GlassTheme = Object.freeze({
  ...(glassData as unknown as GlassTheme),
  fonts: Object.freeze(
    (glassData.fonts as GlassTheme['fonts'][number][]).map((f) => {
      const url = FONT_URLS[`./${f.file}`];
      if (!url) throw new Error(`glass.json names font ${f.file}, which is not in ui/fonts/`);
      return Object.freeze({ ...f, file: url });
    }),
  ),
});

/** A count in words, as the classes' words say one: one to twenty spelled out, and any other number in figures. */
const COUNTS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const count = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 20 ? COUNTS[n]! : String(n));
/* A number the words state, from the numbers they are told, or the compiled default where they are told none. */
const num = (n: Readonly<Record<string, number>>, key: string) => n[key] ?? defaults.economy[key]!;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${count(n)} times`);

/** Each ledger reason, as the log says it: what the character did or drew, plainly, with the numbers it was settled under. */
const REASONS: Readonly<Record<string, string | ((n: Readonly<Record<string, number>>) => string)>> = {
  'face.cheered': 'Cheered: excited, positive reactions to its posts and cards',
  'face.liftedAPost': 'Lifted a post: the cheers a post drew after its Sweet card landed there',
  'face.boredTheRoom': 'Bored the room: bored, negative reactions to its posts and cards',
  'face.stoleThunder': 'Stole the thunder: its card on another\'s post drew more votes than the post this window',
  'heel.drewHeat': 'Drew heat: excited, negative reactions to its posts and cards',
  'heel.stoleThunder': 'Stole the thunder: its Salty card on another\'s post drew more votes than the post this window',
  'heel.shrugged': 'Shrugged off: calm, positive reactions to its posts and cards',
  'jabroni.drewTheGroan': 'Drew the groan: bored, negative reactions to its posts and cards',
  'jabroni.soldTheL': 'Sold the L: a Salty card another player landed on its post',
  'jabroni.takenSincerely': 'Taken sincerely: excited, positive reactions to its posts and cards',
  'lurker.calledIt': 'Called it: among the first to react to a post that then drew a crowd its way',
  'lurker.spunAThread': (n) => {
    const k = num(n, 'lurker.spunThreadRepliers');
    return `Spun a thread: a thread it spun from another's Act drew ${count(k)} other replier${k === 1 ? '' : 's'}`;
  },
  'lurker.cardDrew': 'Its card drew: reactions to a card it played',
  'lurker.postedTooMuch': (n) => {
    const k = num(n, 'lurker.postsAllowed');
    return k === 0 ? 'Posted too much: any post at all, since none are free' : `Posted too much: a post past ${count(k)} in one settlement window`;
  },
  'technician.respected': 'Respected: calm, positive reactions to its posts and cards',
  'technician.evergreen': 'Evergreen: calm, positive reactions that came or went on an older post of its own',
  'technician.draggedIn': 'Dragged in: excited, negative reactions to its posts and cards',
};

/** Every reason this instance's classes write, for the test that holds their words to the numbers in force. */
export const REASON_KEYS: readonly string[] = Object.freeze(Object.keys(REASONS));

/**
 * The economy keys each class description (by class key) and each reason states, so a test can retune them and see the number
 * in force said (the core loop design, section 6, #57). A word that states a number declares at least one key here. The Lurker's
 * description also states the settlement span, which is not an economy key: ClassLook.description is told `settlementLength` (#179).
 */
export const wordsRead: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lurker: ['lurker.postsAllowed'],
  'lurker.spunAThread': ['lurker.spunThreadRepliers'],
  'lurker.postedTooMuch': ['lurker.postsAllowed'],
});

export const instanceUi: InstanceUi = Object.freeze({
  /* The house theme, then four tributes (themes/): each a stylesheet of tokens, the picker's miniature read from the same file. */
  themes: Object.freeze([
    { key: 'house', name: 'House', href: theme, modes: 'both' as const, preview: themePreview },
    { key: 'blue-steel', name: 'Blue Steel', href: blueSteel, modes: 'light' as const, preview: blueSteelPreview },
    { key: 'midnight', name: 'Midnight', href: midnight, modes: 'dark' as const, preview: midnightPreview },
    { key: 'hot-rod', name: 'Hot Rod', href: hotRod, modes: 'dark' as const, preview: hotRodPreview },
    // Fan Site's name is open (the board look design, Open); it ships as "Fan Site" until the owner names it.
    { key: 'fan-site', name: 'Fan Site', href: fanSite, modes: 'dark' as const, preview: fanSitePreview },
  ]),
  // Placeholders until the owner names them.
  quadrantLabels: Object.freeze({
    excitedNegative: 'Heat',
    excitedPositive: 'Hype',
    boredNegative: 'Groan',
    calmPositive: 'Calm',
  }),
  // The React board's quadrants, each in a class's glass colors.
  quadrantClasses: Object.freeze({
    excitedNegative: 'heel',
    excitedPositive: 'face',
    boredNegative: 'jabroni',
    calmPositive: 'technician',
  }),
  // Placeholder looks; each class's look on the reveal's bar is the owner's to give. The marks are the Turn board's.
  // Written in the classes' order (classes/index.ts).
  classLooks: Object.freeze<Record<string, ClassLook>>({
    face: { color: '#2e86de', description: () => 'The crowd\'s favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there.', hurtsBy: () => 'Hurt by bored reactions, and by a card that outdraws the post it was played on.', marks: { label: 'Earns from hype, hurt by the groan', earns: ['excitedPositive'], hurts: ['boredNegative'] } },
    heel: { color: '#c0392b', pattern: 'repeating-linear-gradient(45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: () => 'Earns heat: excited, negative reactions, and a Salty card that outdraws the post it lands on.', hurtsBy: () => 'Hurt by the polite shrug, calm and positive.', marks: { label: 'Earns from heat, hurt by the calm', earns: ['excitedNegative'], hurts: ['calmPositive'] } },
    jabroni: { color: '#d4ac0d', pattern: 'repeating-linear-gradient(0deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: () => 'Anti-comedy: posts built to bomb. Earns from bored, negative reactions and from Salty cards others land on its posts.', hurtsBy: () => 'Hurt by being taken sincerely, excited and positive.', marks: { label: 'Earns from the groan, hurt by hype', earns: ['boredNegative'], hurts: ['excitedPositive'] } },
    technician: { color: '#1e8449', pattern: 'repeating-linear-gradient(0deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px), repeating-linear-gradient(90deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: () => 'The respected regular. Earns from calm, positive reactions to its posts and cards, and more when an old post of its own still draws them.', hurtsBy: () => 'Hurt by heat: excited, negative reactions.', marks: { label: 'Earns from the calm, hurt by heat', earns: ['calmPositive'], hurts: ['excitedNegative'] } },
    lurker: { color: '#7f8c8d', pattern: 'radial-gradient(rgb(0 0 0 / 0.3) 1px, transparent 1.5px) 0 0 / 5px 5px', description: () => `Reads the room. Earns by reacting early in the direction a post ends up, by spinning threads others reply to, and from reactions to its cards.`, hurtsBy: (e, span) => `Hurt by ${num(e, 'lurker.postsAllowed') === 0 ? 'posting at all' : `posting more than ${times(num(e, 'lurker.postsAllowed'))} in one settlement window (${spanWords(span)})`}.`, marks: { label: 'Earns by calling where any post ends up', calls: ['excitedNegative', 'excitedPositive', 'boredNegative', 'calmPositive'] } },
  }),
  reasonWords: (reason: string, params: Readonly<Record<string, number>>) => {
    const w = REASONS[reason];
    return w === undefined ? `Settled under "${reason}"` : typeof w === 'string' ? w : w(params);
  },
  copy: Object.freeze({
    siteName: 'Divided World',
    siteTagline: 'dw.gripe',
    // Who speaks for the board: the glass names no one but these (the board look design, section 7).
    roleWord: 'The Boss',
    staffWord: 'The staff',
    gameWord: 'the game',
    staffBoardTag: 'Staff post here; you react and spin',
    // The footer's 80 by 15 badges: pairs of short words, decoration in the footer's pixel face (Silkscreen, fonts/).
    badges: Object.freeze([Object.freeze(['Game', 'On'] as const), Object.freeze(['Masks', 'On'] as const), Object.freeze(['Kilter', 'Off'] as const)]),
    // What the log and the machine's group label call the shop, in plain words; the sign draws one of `marquees`.
    shopName: 'Vending Machine',
    // The sign's names, one picked each time the Vending screen opens (decoration; none claims anything untrue; at most 20 characters each).
    marquees: Object.freeze(['[MACHINE NAME]', 'AURA-MATIC 3000', 'VEND-ETTA', 'THE CARD SHARK', 'POSTCARD PALACE', 'COIN-OP KAYFABE', 'MERCH TABLE', 'CHEAP POP', 'FINISHER FRIDGE', 'GIMMICK DISPENSER', 'HEAT LAMP', 'NO FOOD, ONLY CARDS']),
    // The Settings board's words for Motion (docs/research/2026-10-29-two-worlds/11-settings.html).
    reducedMotionCard: 'Stick Around still snaps you back, only instantly.',
    /* What the glass calls a Mod Bot where the Lens names its role (the Mod Bots design, section 9). */
    modRole: 'A Moderator',
    // Hints (the alerts design's section 5): playful, and never a bluff.
    alerts: Object.freeze({ hint: hintWords }),
  }),
  pips: Object.freeze({ default: { full: pipFull, empty: pipEmpty } }),
  /* The developer persona's picture, by the key the instance's rules name (index.ts, `developer`). */
  avatars: Object.freeze({ gabe }),
  glass,
  cards: cardsUi,
  /* The back of a card wears the favicon's coin (the owner's word, 2026-11-07). */
  cardBack: { mark: coinUrl },
  onboarding,
  frontDoor,
  /* The Strategy Guide's Markdown and Gabe's hint for each class (guide/); tools/check-guide.mjs holds both to the instance. */
  guide: Object.freeze({ markdown: strategyGuide, hints }),
});
