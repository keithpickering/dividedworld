/**
 * Divided World's look and out-of-character words for the engine's screens, through
 * engine/ui/'s `InstanceUi`. The composition root (web/) is the one place this meets the engine.
 *
 * The quadrant labels, each class's look and description, and the shop's name are placeholders
 * the owner has not yet named (the web plan's brief, item 7); each is marked where it stands.
 */
import type { GlassTheme, InstanceUi } from '../../../engine/ui/types.ts';
import glassData from './glass.json';
import theme from './theme.css?url';
import pipFull from './pips/default-full.svg?url';
import pipEmpty from './pips/default-empty.svg?url';

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

/** Each ledger reason, as the log says it: what the character did or drew, plainly. */
const REASONS: Readonly<Record<string, string>> = {
  'face.cheered': 'Cheered: excited, positive reactions to its posts and cards',
  'face.liftedAPost': 'Lifted a post: the cheers a post drew after its Sweet card landed there',
  'face.boredTheRoom': 'Bored the room: bored, negative reactions to its posts and cards',
  'face.stoleThunder': 'Stole the thunder: its card on another\'s post drew more than the post',
  'heel.drewHeat': 'Drew heat: excited, negative reactions to its posts and cards',
  'heel.stoleThunder': 'Stole the thunder: its Salty card on another\'s post drew more than the post',
  'heel.shrugged': 'Shrugged off: calm, positive reactions to its posts and cards',
  'jabroni.drewTheGroan': 'Drew the groan: bored, negative reactions to its posts and cards',
  'jabroni.soldTheL': 'Sold the L: a Salty card another player landed on its post',
  'jabroni.takenSincerely': 'Taken sincerely: excited, positive reactions to its posts and cards',
  'lurker.calledIt': 'Called it: among the first to react to a post that then drew a crowd its way',
  'lurker.spunAThread': 'Spun a thread: a thread it spun from another\'s Act drew three other repliers',
  'lurker.cardDrew': 'Its card drew: reactions to a card it played',
  'lurker.postedTooMuch': 'Posted too much: a post past three in one day',
};

export const instanceUi: InstanceUi = Object.freeze({
  themes: Object.freeze([{ key: 'house', name: 'House (black and white)', href: theme, modes: 'both' as const }]),
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
    calmPositive: 'lurker',
  }),
  // Placeholder looks; each class's look on the reveal's bar is the owner's to give.
  classLooks: Object.freeze({
    face: { color: '#2e86de', description: 'The crowd\'s favorite. Earns from excited, positive reactions, and from the cheers a post draws after its Sweet card lands there. Hurt by bored reactions, and by a card that outdraws the post it was played on.' },
    heel: { color: '#c0392b', pattern: 'repeating-linear-gradient(45deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: 'Earns heat: excited, negative reactions, and a Salty card that outdraws the post it lands on. Hurt by the polite shrug, calm and positive.' },
    lurker: { color: '#7f8c8d', pattern: 'radial-gradient(rgb(0 0 0 / 0.3) 1px, transparent 1.5px) 0 0 / 5px 5px', description: 'Reads the room. Earns by reacting early in the direction a post ends up, by spinning threads others reply to, and from reactions to its cards. Hurt by posting more than three times a day.' },
    jabroni: { color: '#d4ac0d', pattern: 'repeating-linear-gradient(0deg, transparent 0 4px, rgb(0 0 0 / 0.25) 4px 6px)', description: 'Anti-comedy: posts built to bomb. Earns from bored, negative reactions and from Salty cards others land on its posts. Hurt by being taken sincerely, excited and positive.' },
  }),
  reasonWords: (reason: string) => REASONS[reason] ?? `Settled under "${reason}"`,
  copy: Object.freeze({
    siteName: 'Divided World',
    siteTagline: 'dw.gripe',
    // The owner names the machine later.
    shopName: 'The Vending Machine',
  }),
  pips: Object.freeze({ default: { full: pipFull, empty: pipEmpty } }),
  glass,
});
