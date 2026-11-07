/**
 * What everyone will see, said before a player chooses: the lines that will be posted, The
 * System's for a debut or a Turn and the character's own for a reveal, in the words the thread
 * draws them in (thread/lines.tsx; a test holds the two together), so a preview is a promise kept
 * and never a guess. A class is named only where the
 * player chose an option that names it ("with its class", "name the new class", "name the old
 * class"); every other option's preview carries none, and a silent one says nobody is told.
 */

import { words, type PronounSet } from '../../rules/pronouns.ts';

export interface PreviewLine {
  readonly by: string;
  readonly text: string;
}

export interface Preview {
  /** The Acts that will be posted, in the order they appear. */
  readonly lines: readonly PreviewLine[];
  /** Said instead of lines where nothing is posted. */
  readonly nothing: string | null;
  /** Where and when it appears. */
  readonly where: string;
}

const SYSTEM = 'The System';
const say = (text: string): PreviewLine => ({ by: SYSTEM, text });

export function debutPreview(o: { readonly name: string; readonly className: string; readonly pronouns: PronounSet; readonly timing: 'now' | 'tally'; readonly loudness: 'silent' | 'announced' | 'with_class' }): Preview {
  const now = o.timing === 'now';
  const w = words(o.pronouns);
  if (o.loudness === 'silent') {
    return {
      lines: [],
      nothing: now ? `Nothing is posted. ${o.name} is on the board at once, and ${w.their} first post is ${w.their} entrance.` : `Nothing is posted. ${o.name} simply appears after the next settlement.`,
      where: now ? 'At once' : 'At the next settlement',
    };
  }
  /* Before a class card is chosen, the preview says where the class will go rather than reading broken. */
  const cls = o.className || '(the class you choose)';
  const lines = o.loudness === 'with_class' ? [say(`${o.name} debuts as ${cls}`), say(`${o.name} revealed: ${cls}`)] : [say(`${o.name} debuts`)];
  return {
    lines,
    nothing: null,
    where: now ? 'At once, in the season’s Turns thread' : 'In the tally at the next settlement, in the season’s Turns thread',
  };
}

/**
 * The words naming a class adds to a Turn's tally line, which the Turn's names quote: the one
 * function the names, the preview and the tally that posts it all read, so a name never promises
 * words the post does not carry.
 */
export function turnNamedWords(o: { readonly was: string; readonly to: string }): { readonly old: string; readonly new: string } {
  return { old: `from ${o.was}`, new: `to ${o.to}` };
}

export function turnPreview(o: { readonly name: string; readonly was: string; readonly to: string; readonly loudness: 'silent' | 'announced'; readonly showFrom: boolean; readonly showTo: boolean }): Preview {
  if (o.loudness === 'silent') {
    return { lines: [], nothing: `Nothing is posted. Nobody is told that ${o.name} has Turned.`, where: 'At the next settlement' };
  }
  const words = turnNamedWords(o);
  const tally = `${o.name} has Turned${o.showFrom ? ` ${words.old}` : ''}${o.showTo ? ` ${words.new}` : ''}`;
  return {
    lines: o.showTo ? [say(tally), say(`${o.name} revealed: ${o.to}`)] : [say(tally)],
    nothing: null,
    where: 'In the tally at the next settlement, in the season’s Turns thread',
  };
}

/**
 * A reveal: the character's own Act, so its one line is the character's, read as UnmaskLine draws
 * it. The message is trimmed as the request trims it before it is stored (casterMessage,
 * engine/rules/cards.ts), so one of spaces alone adds no words.
 */
export function revealPreview(o: { readonly name: string; readonly className: string; readonly message: string; readonly threadTitle: string | null }): Preview {
  const said = o.message.trim();
  return {
    lines: [{ by: o.name, text: `${o.name} revealed: ${o.className}${said ? ` — “${said}”` : ''}` }],
    nothing: null,
    where: `At once, in ${o.threadTitle ?? 'the thread you choose'}`,
  };
}
