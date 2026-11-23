/**
 * Divided World's look and out-of-character words for the engine's screens, through
 * engine/ui/'s `InstanceUi`. The composition root (web/) is the one place this meets the engine.
 *
 * The quadrant labels, each class's look and description, and the shop's name are placeholders
 * the owner has not yet named (the web plan's brief, item 7); each is marked where it stands.
 */
import type { ClassLook, GlassTheme, InstanceUi } from '../../../engine/ui/types.ts';
import type { Settings } from '../../../engine/rules/types.ts';
import { spanWords } from '../../../engine/ui/characters/format.ts';
import { fractionWords, shareWords } from '../../../engine/ui/copy-words.ts';
import glassData from './glass.json';
import { cardsUi } from './cards.ts';
import { quadrantLabels } from './quadrant-labels.ts';
import { cards as instanceCards } from '../cards/index.ts';
import { packsUi } from './packs.ts';
import { sounds } from './sounds.ts';
import { gearUi, trophiesUi } from './cosmetics.ts';
import theme from './theme.css?url';
import themePreview from './theme.css?preview';
import blueSteel from './themes/blue-steel.css?url';
import blueSteelPreview from './themes/blue-steel.css?preview';
import midnight from './themes/midnight.css?url';
import midnightPreview from './themes/midnight.css?preview';
import hotRod from './themes/hot-rod.css?url';
import hotRodPreview from './themes/hot-rod.css?preview';
import hotDebateFire from './themes/hot-debate/fire.gif?url';
import hotDebateFireStill from './themes/hot-debate/fire-still.png?url';
import fanSite from './themes/fan-site.css?url';
import fanSitePreview from './themes/fan-site.css?preview';
import coinUrl from './icon/coin.svg?url';
import cardBackCanvas from './card-back/art.webp?url';
import pipFull from './pips/default-full.svg?url';
import pipEmpty from './pips/default-empty.svg?url';
import gabe from './avatars/gabe.png?url';
import fangameSquare from './avatars/fangame-square.webp?url';
import fangamePortrait from './avatars/fangame-portrait.webp?url';
import { hintWords } from './hint-words.ts';
import { trapStruckWords } from './trap-words.ts';
import { onboarding } from './onboarding.ts';
import { frontDoor } from './front-door.ts';
import strategyGuide from '../guide/strategy-guide.md?raw';
import { hints } from '../guide/hints.ts';
import { conduct } from './conduct.ts';
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
const num = (n: Readonly<Record<string, number | string>>, key: string) => { const v = n[key]; return typeof v === 'number' ? v : defaults.economy[key]!; };
/* A reward's multiple, as the clause that follows what is paid: nothing for 0, half a vote for 0.5, one vote's worth for 1, "double" and "triple", and a count
 * of times over for the rest, a half said in words ("one and a half") and any other fraction in figures. True at every value `min: 0` allows. */
const multiple = (n: number) => {
  if (n === 0) return 'which pay nothing';
  if (n === 0.5) return 'each paid as half a vote';
  if (n === 1) return 'each paid as one vote';
  if (n === 2) return 'each paid double';
  if (n === 3) return 'each paid triple';
  if (Number.isInteger(n)) return `each paid ${count(n)} times over`;
  if (Number.isInteger(n - 0.5) && n > 0 && n < 20) return `each paid ${count(n - 0.5)} and a half times over`;
  return `each paid ${n} times over`;
};
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${count(n)} times`);

/** Each ledger reason, as the log says it: what the character did or drew, plainly, with the numbers it was settled under. */
const REASONS: Readonly<Record<string, string | ((n: Readonly<Record<string, number | string>>, amount?: number) => string)>> = {
  'face.cheered': 'Cheered: excited, positive reactions to the character\'s posts and cards',
  'face.liftedAPost': 'Lifted a post: the cheers a post drew after its Sweet card landed there',
  'face.boredTheRoom': 'Bored the room: bored, negative reactions to the character\'s posts and cards',
  'face.stoleThunder': 'Stole the thunder: a card the character played on another\'s post drew more votes than the post this window. Not charged where the post\'s reactions are mostly negative, or where the card answered a Salty play',
  'heel.drewHeat': 'Drew heat: excited, negative reactions to the character\'s posts and cards',
  'heel.stoleThunder': 'Stole the thunder: a Salty card the character played on another\'s post drew more votes than the post this window',
  'heel.shrugged': 'Shrugged off: calm, positive reactions to the character\'s posts and cards',
  'jabroni.drewTheGroan': 'Drew the groan: bored, negative reactions to the character\'s posts and cards',
  'jabroni.soldTheL': 'Sold the L: a Salty card another player landed on the character\'s post',
  'jabroni.takenSincerely': 'Taken sincerely: excited, positive reactions to the character\'s posts and cards',
  'lurker.calledIt': 'Called it: among the first to react to a post that then drew a crowd its way',
  'lurker.misread': 'Misread it: among the first to react to a post that then drew a crowd another way',
  'lurker.spunAThread': (n) => {
    const k = num(n, 'lurker.spunThreadRepliers');
    return `Spun a thread: a thread the character spun from another's Act drew ${count(k)} other replier${k === 1 ? '' : 's'}`;
  },
  'lurker.cardDrew': 'Card drew: reactions to a card the character played',
  'lurker.postedTooMuch': (n) => {
    const k = num(n, 'lurker.postsAllowed');
    return k === 0 ? 'Posted too much: any post at all, since none are free' : `Posted too much: a post past ${count(k)} in one settlement window`;
  },
  'technician.respected': 'Respected: calm, positive reactions to the character\'s posts and cards',
  'technician.evergreen': 'Evergreen: calm, positive reactions that came or went on an older post by that character',
  'technician.draggedIn': 'Dragged in: excited, negative reactions to the character\'s posts and cards',
  'tweener.splitTheRoom': 'Split the room: hype and heat on the character\'s post or card, paid on the smaller side, each player counted once by where they lean',
  'tweener.stirredThePot': 'Stirred the pot: hype and heat drawn to another\'s post by players who came after the character\'s card, paid on the smaller side',
  /* A card's boost (settlement's `card.boost`, params `{ card }`): the card's key is public (it is on the post), so its name is said; a card this instance does not have is "a card". */
  'card.boost': (n, amount) => {
    const name = instanceCards.find((c) => c.key === n['card'])?.name ?? 'A card';
    /* An entry settled with a flat size says it; one with a `by`, or none (a row settled before the flat earn), keeps the words it had. */
    const flat = n['flat'];
    if (typeof flat !== 'number') return `${name} added: what the card's boost on a reaction earned`;
    /* A line below zero takes pay back: a vote the card paid for moved away (a reaction cannot be removed, but a player who adds one elsewhere moves part of their vote). It has words of its own (#799), since "more" reads as a gain. */
    if (amount !== undefined && amount < 0) return `${name}: up to ${shareWords(flat)} taken back for each vote it named that later moved away`;
    return `${name}: up to ${shareWords(flat)} more for each vote it named, from players who first reacted while it was up`;
  },
  /* The crowd floor (settlement's `crowd.floor`, no class): a vote the character's class neither pays nor charges. A line below zero takes back the floor paid on a share the vote left (paid_votes.floored). */
  'crowd.floor': (_n, amount) => (amount !== undefined && amount < 0
    ? 'The crowd noticed: taken back, for a vote that moved off a quadrant where it was paid'
    : 'The crowd noticed: a reaction the character\'s class neither pays nor charges'),
  /* The reveal perk (settlement's `reveal.perk`, params `{ share }`): the share is the settings' own, said as a fraction. */
  'reveal.perk': (n) => {
    const share = n['share'];
    return `Playing it openly: ${typeof share === 'number' ? `${fractionWords(share)} more` : 'more'} on what reactions earned while the character's reveal was current`;
  },
  /* A card's cushion (settlement's `card.cushion`, params `{ card, share }`): the share is the entry's own, said as a fraction; a card this instance does not have is "A card". */
  'card.cushion': (n) => {
    const share = n['share'];
    return `${instanceCards.find((c) => c.key === n['card'])?.name ?? 'A card'}: ${typeof share === 'number' ? fractionWords(share) : 'part'} of each loss from a reaction, given back`;
  },
  /* A card's payout (settlement's `card.skim` and `card.ride`, params `{ card }`): the card is named and its share said from its own rules, never restated here; a card this instance does not have, or one that is not the kind this reason is for, is "A card". */
  'card.skim': (n) => {
    const card = instanceCards.find((c) => c.key === n['card']);
    return card?.skim === undefined ? 'A card: what its payout on a reaction earned' : `${card.name}: ${shareWords(card.skim.share)} for each vote its post drew in the reactions it named, from players who first reacted after it`;
  },
  'card.ride': (n) => {
    const card = instanceCards.find((c) => c.key === n['card']);
    if (card?.gimmick?.kind === 'ride') return `${card.name}: ${shareWords(card.gimmick.share)} for each vote on a Move another player cast on the post`;
    const outcome = card?.trap?.outcome;
    if (card !== undefined && outcome?.kind === 'ride' && outcome.every === true) return `${card.name}: ${shareWords(outcome.share)} for each vote on the card whose cast sprang it`;
    if (card !== undefined && outcome?.kind === 'ride') return `${card.name}: ${shareWords(outcome.share)} for each vote, of the kind it named, on the Move that sprang it`;
    return 'A card: what its payout on a reaction earned';
  },
  'tweener.shrugged': 'Shrugged off: calm or bored reactions to the character\'s posts and cards',
  'tweener.litTheFuse': (n) => {
    const days = typeof n.debateDays === 'number' ? n.debateDays : defaults.debateDays;
    return `Lit the fuse: within ${count(days)} day${days === 1 ? '' : 's'} of the character's post, ${count(num(n, 'tweener.catalystVoices'))} or more other players were arguing under it, ${count(num(n, 'tweener.catalystReturned'))} of them more than once, in quotes of it and threads spun from it, and the character's player had not posted in it`;
  },
  'tweener.outvoted': 'Outvoted: the players arguing under the character\'s post cancel its calm and bored reactions, a player for each vote, less the share a cushion card has covered. Taken back where a reaction moved away',
};

/** Every reason this instance's classes write, for the test that holds their words to the numbers in force. */
export const REASON_KEYS: readonly string[] = Object.freeze(Object.keys(REASONS));

/**
 * The economy keys each class description (by class key) and each reason states, so a test can retune them and see the number
 * in force said (the core loop design, section 6, #57). A word that states a number declares at least one key here. The Lurker's
 * description also states the settlement span, which is not an economy key: ClassLook.description is told `settlementLength` (#179).
 */
export const wordsRead: Readonly<Record<string, readonly string[]>> = Object.freeze({
  heel: ['heel.heatVotes'],
  jabroni: ['jabroni.groanVotes'],
  lurker: ['lurker.postsAllowed'],
  'lurker.spunAThread': ['lurker.spunThreadRepliers'],
  'lurker.postedTooMuch': ['lurker.postsAllowed'],
  'tweener.litTheFuse': ['tweener.catalystVoices', 'tweener.catalystReturned'],
});

/**
 * The settings beside the economy each reason states, by key in `Settings`: the earning carries each in its params, under the same key,
 * so a settled line is said with the number it was settled under, and a test can retune them as it does `wordsRead`'s.
 */
/** A key of `Settings` whose value is a number: the only kind a reason's words can state. */
type NumberSetting = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
export const settingsRead: Readonly<Record<string, readonly NumberSetting[]>> = Object.freeze({
  'tweener.litTheFuse': ['debateDays'],
});

export const instanceUi: InstanceUi = Object.freeze({
  /* The house theme, then four tributes (themes/): each a stylesheet of tokens, the picker's miniature read from the same file. */
  themes: Object.freeze([
    { key: 'house', name: 'House', href: theme, modes: 'both' as const, preview: themePreview },
    { key: 'blue-steel', name: 'Blue Steel', href: blueSteel, modes: 'light' as const, preview: blueSteelPreview },
    { key: 'midnight', name: 'Midnight', href: midnight, modes: 'dark' as const, preview: midnightPreview },
    // Hot Debate shipped as Hot Rod and keeps that key, which accounts store. Its banner fire is Nevit Dilmen's (themes/hot-debate/CREDITS.md).
    { key: 'hot-rod', name: 'Hot Debate', href: hotRod, modes: 'dark' as const, preview: hotRodPreview, banner: Object.freeze({
      moving: hotDebateFire,
      still: hotDebateFireStill,
      height: 56,
      clear: 40,
      credit: Object.freeze({
        work: 'Animated fire',
        author: 'Nevit Dilmen',
        source: 'https://commons.wikimedia.org/wiki/File:Animated_fire_by_nevit.gif',
        license: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
      }),
    }) },
    // Fan Site's name is open (the board look design, Open); it ships as "Fan Site" until the owner names it.
    { key: 'fan-site', name: 'Fan Site', href: fanSite, modes: 'dark' as const, preview: fanSitePreview },
  ]),
  quadrantLabels,
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
    face: { color: '#2e86de', description: () => 'The crowd\'s favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there.', hurtsBy: () => 'Hurt by bored reactions, and by stealing a non-Salty post\'s thunder.', marks: { label: 'Earns from hype, hurt by the groan', earns: ['excitedPositive'], hurts: ['boredNegative'] } },
    heel: { color: '#c0392b', pattern: 'repeating-linear-gradient(45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: (e) => `Earns heat: excited, negative reactions, ${multiple(num(e, 'heel.heatVotes'))}, and a Salty card that outdraws the post it lands on.`, hurtsBy: () => 'Hurt by the polite shrug, calm and positive.', marks: { label: 'Earns from heat, hurt by the calm', earns: ['excitedNegative'], hurts: ['calmPositive'] } },
    jabroni: { color: '#d4ac0d', pattern: 'repeating-linear-gradient(0deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: (e) => `Anti-comedy: posts built to bomb. Earns from bored, negative reactions, ${multiple(num(e, 'jabroni.groanVotes'))}, and from Salty cards others land on the character's posts.`, hurtsBy: () => 'Hurt by being taken sincerely, excited and positive.', marks: { label: 'Earns from the groan, hurt by hype', earns: ['boredNegative'], hurts: ['excitedPositive'] } },
    technician: { color: '#1e8449', pattern: 'repeating-linear-gradient(0deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px), repeating-linear-gradient(90deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: () => 'The respected regular. Earns from calm, positive reactions to the character\'s posts and cards, and more when an old post still draws them.', hurtsBy: () => 'Hurt by heat: excited, negative reactions.', marks: { label: 'Earns from the calm, hurt by heat', earns: ['calmPositive'], hurts: ['excitedNegative'] } },
    tweener: { color: '#d63ab8', pattern: 'repeating-linear-gradient(45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px), repeating-linear-gradient(-45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: () => 'Splits the room. Earns when a post or card draws hype and heat in equal measure, and when the character\'s card sets someone else\'s post arguing. Also earns when its post sets others debating and it stays out, and the debate cancels that post\'s shrugs.', hurtsBy: () => 'Hurt by the shrug: calm or bored reactions.', marks: { label: 'Earns from a room split between hype and heat, hurt by the shrug', splits: ['excitedNegative', 'excitedPositive'], hurts: ['boredNegative', 'calmPositive'] } },
    lurker: { color: '#7f8c8d', pattern: 'radial-gradient(rgb(0 0 0 / 0.3) 1px, transparent 1.5px) 0 0 / 5px 5px', description: () => `Reads the room. Earns by reacting early in the direction a post ends up, by spinning threads others reply to, and from reactions to the character's cards.`, hurtsBy: (e, span) => `Hurt by early calls that go the other way, and by ${num(e, 'lurker.postsAllowed') === 0 ? 'posting at all' : `posting more than ${times(num(e, 'lurker.postsAllowed'))} in one settlement window (${spanWords(span)})`}.`, marks: { label: 'Earns by calling where any post ends up', calls: ['excitedNegative', 'excitedPositive', 'boredNegative', 'calmPositive'] } },
  }),
  reasonWords: (reason: string, params: Readonly<Record<string, number | string>>, amount?: number) => {
    const w = REASONS[reason];
    return w === undefined ? `Settled under "${reason}"` : typeof w === 'string' ? w : w(params, amount);
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
    // A card's kind tag: a Move is cast (or set face down), a Reversal is only set face down, a Gimmick is used face up on your own post, character or thread.
    cardKinds: Object.freeze({ cast: 'Move', set: 'Reversal', use: 'Gimmick' }),
    // What the log and the machine's group label call the shop, in plain words; the sign draws one of `marquees`.
    shopName: 'Vending Machine',
    // The sign's names, one picked each time the Vending screen opens (decoration; none claims anything untrue; at most 20 characters each).
    marquees: Object.freeze(['FRESH BEEF', 'HAVE U SEEN LUIGI?', 'FAT WARIOS PLZ', 'HAHA, GACHA!', 'FORK IT OVER', 'RIZZY DRINKS', 'YOU EARNED IT', 'GO OFF, JOKER', 'NO SCALPING', 'JUST THIS ONCE', "LET 'EM HAVE IT", 'TCG-WHIZ', 'I CHOOSE YOU!', 'DO NOT SHAKE', 'LOST THE GAME', 'HAPPY TO HELP', 'JUST GLAD 2B HERE', 'WATCHIN U EAT', 'ORB FREAK', '<3 OF THE CARDS', 'YOUR BEST VEND', '[404 NOT FOUND]']),
    // The Settings board's words for Motion (docs/research/2026-10-29-two-worlds/11-settings.html).
    reducedMotionCard: 'Stick Around still snaps you back, only instantly.',
    /* What the glass calls a Mod Bot where the Lens names its role (the Mod Bots design, section 9). */
    modRole: 'A Moderator',
    // Hints (the alerts design's section 5) and a face-down card that struck: playful, and never a bluff.
    alerts: Object.freeze({ hint: hintWords, trapStruck: trapStruckWords }),
  }),
  pips: Object.freeze({ default: { full: pipFull, empty: pipEmpty } }),
  /* The developer persona's picture, by the key the instance's rules name (index.ts, `developer`). */
  avatars: Object.freeze({ gabe }),
  /* The staff personas' pictures, by roster key (FanGaME, the first Boss). */
  staffAvatars: Object.freeze({ fangame: Object.freeze({ square: fangameSquare, portrait: fangamePortrait }) }),
  glass,
  cards: cardsUi,
  packs: packsUi,
  /* The laugh track: the audience's sounds, each with its caption (sounds.ts). */
  sounds,
  gear: gearUi,
  trophies: trophiesUi,
  /* The back of a card wears the favicon's coin (the owner's word, 2026-11-07). */
  /* The back's picture holds the coin, raised and glowing; the mark is still given, for a back drawn without it. */
  cardBack: { mark: coinUrl, canvas: cardBackCanvas },
  onboarding,
  frontDoor,
  /* The Strategy Guide's Markdown and Gabe's hint for each class (guide/); tools/check-guide.mjs holds both to the instance. */
  guide: Object.freeze({ markdown: strategyGuide, hints }),
  /* The code of conduct (conduct.ts), version 1: the words are the instance's, the page at /conduct the glass's. */
  conduct,
});
