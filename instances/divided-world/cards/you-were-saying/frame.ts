/**
 * The frame You Were Saying? gives the old voice (docs/plans/2026-11-07-you-were-saying-design.md, section 3): a 2003 thread page that
 * ends exactly where the post's words end, so the model continues the post mid-line. The prompt holds the header line, the thread's
 * title, each earlier post as `Name:` and its text, then `Name:` and the post's text with the tails already chained on it, and nothing
 * after: no newline and no space is added at the end.
 *
 * Nobody's words can shape the page. Every name, title and earlier post is collapsed to one line, and so is the post and every tail, so a
 * line that starts a post (`Name:`), a rule (`---`) or the header never comes from anything but this file. The stops are for what the model
 * writes: where it starts a new post, a quote, a rule or the header again, it has left the post. A player's words never reach the stops,
 * because nothing in the prompt holds a newline of theirs for a stop to match.
 */
import type { WriteFrameInput } from '../../../../engine/rules/cards.ts';

export const HEADER = 'Welcome to the Message Boards - Thread View';

/** Where the model has left the post: a quote, a rule, a post header, or the page's own header again. A newline starts each, so it is a line's start. */
export const STOPS: readonly string[] = Object.freeze(['\nQuote:', '\n---', '\nPosted:', `\n${HEADER}`]);

const NAME_MOST = 60;
const TITLE_MOST = 200;
const BEFORE_MOST = 500;

/** Every run of white space (a newline, a tab, a Unicode line separator) becomes one space. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');
const oneLine = (s: string): string => flat(s).trim();
const clip = (s: string, most: number): string => {
  const chars = [...oneLine(s)];
  return chars.length <= most ? chars.join('') : `${chars.slice(0, most).join('').trimEnd()}…`;
};

/**
 * The prompt and its stops. The post's own words lose only their leading space and their trailing space (a model's first token carries its
 * own), and each tail keeps its own edges, as the model wrote them, so the chain reads as one run; only a tail's line breaks become spaces.
 */
export function youWereSayingFrame(input: WriteFrameInput): { readonly prompt: string; readonly stop: readonly string[] } {
  const lines = [HEADER, `Thread: ${clip(input.title, TITLE_MOST)}`, ''];
  for (const p of input.before) lines.push(`${clip(p.name, NAME_MOST)}: ${clip(p.text, BEFORE_MOST)}`);
  const run = oneLine(input.post.text) + input.tails.map(flat).join('');
  lines.push(`${clip(input.post.name, NAME_MOST)}: ${run}`);
  return { prompt: lines.join('\n'), stop: STOPS };
}
