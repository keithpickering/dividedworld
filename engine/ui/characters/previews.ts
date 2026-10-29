/**
 * What everyone will see, said before a player chooses: the lines The System will post for a
 * debut or a Turn, in the words the thread draws them in (thread/lines.tsx; a test holds the two
 * together), so a preview is a promise kept and never a guess. A class is named only where the
 * player chose an option that names it ("with its class", "name the new class", "name the old
 * class"); every other option's preview carries none, and a silent one says nobody is told.
 */

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

export function debutPreview(o: { readonly name: string; readonly className: string; readonly timing: 'now' | 'tally'; readonly loudness: 'silent' | 'announced' | 'with_class' }): Preview {
  const now = o.timing === 'now';
  if (o.loudness === 'silent') {
    return {
      lines: [],
      nothing: now ? `Nothing is posted. ${o.name} is on the board at once, and its first post is its entrance.` : `Nothing is posted. ${o.name} simply appears after the next settlement.`,
      where: now ? 'At once' : 'At the next settlement',
    };
  }
  const lines = o.loudness === 'with_class' ? [say(`${o.name} debuts as ${o.className}`), say(`${o.name} revealed: ${o.className}`)] : [say(`${o.name} debuts`)];
  return {
    lines,
    nothing: null,
    where: now ? 'At once, in the season’s Turns thread' : 'In the tally at the next settlement, in the season’s Turns thread',
  };
}

export function turnPreview(o: { readonly name: string; readonly was: string; readonly to: string; readonly loudness: 'silent' | 'announced'; readonly showFrom: boolean; readonly showTo: boolean }): Preview {
  if (o.loudness === 'silent') {
    return { lines: [], nothing: `Nothing is posted. Nobody is told that ${o.name} has Turned.`, where: 'At the next settlement' };
  }
  const tally = `${o.name} has Turned${o.showFrom ? ` from ${o.was}` : ''}${o.showTo ? ` to ${o.to}` : ''}`;
  return {
    lines: o.showTo ? [say(tally), say(`${o.name} revealed: ${o.to}`)] : [say(tally)],
    nothing: null,
    where: 'In the tally at the next settlement, in the season’s Turns thread',
  };
}
