/**
 * What everyone will see, said before a player chooses: the lines that will be posted, the character's own in every case (an
 * announced Turn is the character's own Act in the thread it names, and a reveal its own Act), in the words
 * the thread draws them in (thread/lines.tsx, `announceWords`; a test holds the two together), so a preview is a promise kept and
 * never a guess. A class is named only where the player chose an option that names it ("with its class", "name the new class",
 * "name the old class"); every other option's preview carries none, and a silent one says nobody is told.
 */
import { announceWords } from '../thread/lines.tsx';

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

/** A class is previewed by the name the player sees on its card, which is the key `announceWords` is given. */
const named = (name: string) => name;
/** An announced Turn is always written ahead of its settlement (0435), so its line carries the sentence that says when it takes effect. */
const own = (name: string, was: string, to: string): PreviewLine => ({ by: name, text: `${name} ${announceWords('turn', was, to, named, true)}` });

/**
 * The words naming a class adds to a Turn's old tally line (the Reveal board still draws a tally this way): the one function that
 * screen's names read.
 */
export function turnNamedWords(o: { readonly was: string; readonly to: string }): { readonly old: string; readonly new: string } {
  return { old: `from ${o.was}`, new: `to ${o.to}` };
}

export function turnPreview(o: { readonly name: string; readonly was: string; readonly to: string; readonly loudness: 'silent' | 'announced'; readonly showFrom: boolean; readonly showTo: boolean; readonly threadTitle?: string | null }): Preview {
  if (o.loudness === 'silent') {
    return { lines: [], nothing: `Nothing is posted. Nobody is told that ${o.name} has Turned.`, where: 'Nowhere: a silent Turn is posted nowhere' };
  }
  return {
    lines: [own(o.name, o.showFrom ? o.was : '', o.showTo ? o.to : '')],
    nothing: null,
    where: `At once, in ${o.threadTitle ?? 'the thread you choose'}`,
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
