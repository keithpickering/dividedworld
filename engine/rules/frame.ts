/**
 * How tall a post's content area can honestly be, so a draw's declared frame is held to the post it is drawn on (issue #1259; the owner's
 * answer: "Go ahead with the recommendation", option 1). A surface card counts a tag in the box its drawer's screen measured (the content area,
 * in ems of the post's text, `CardRules.surface.frameOf`), while every reader's screen draws the strokes rigid in ems or in image widths. So
 * a box declared taller than the post, or an image group declared smaller than it was, makes a tag count less than it covers. The server
 * refuses a box taller than `tallestBox` allows at its own width, and an image group whose `em` is wider than its box (an image is never
 * wider than the content area: engine/ui/bbcode/bbcode.css, `.kb-bb-img`, max-width 100%).
 *
 * Pure: no DOM, no vendor client, and nothing here knows which instance runs it. The estimate lays the post out the way the board's CSS
 * does, from above, and never below: every allowance is chosen so an honest box made at any width the app draws and any text size it
 * offers lies under it with room (frame.test.ts holds the boxes measured in a browser), because a refused honest tag is worse than slack.
 *
 * What the content area holds (engine/ui/thread/Post.tsx `Body`, thread.css `.kb-act-main`): the post's words (whichever version is shown:
 * a live rewind shows an older one, so every version is laid out and the tallest counts), the notes the engine sets in it (Last edited, a
 * ruling, a moderator's notice), its poll, its reactions row and its character's signature, inside 0.5em of padding top and bottom, and never
 * shorter than the 22.5em the body's min-height gives it.
 */
import { parse, type BbNode } from '../bbcode/parse.ts';

/** The words of one version of a post, with the forged verdict it is drawn with (anchor.ts `contentOf` takes the same). */
export interface FrameVersion { readonly body: string; readonly forged?: ReadonlySet<string> }
/** What a post shows in its content area beyond the engine's own lines: its versions' words, its character's signature, its poll, and how many reaction kinds can stand in its row. */
export interface PostFrame {
  readonly versions: readonly FrameVersion[];
  readonly signature?: string;
  readonly poll?: { readonly question: string; readonly options: readonly string[] } | null;
  /** The instance's reaction kinds, which the row can show all of. */
  readonly reactions: number;
}
/** A draw's declared frame: its box in ems, and each image group's `em` (how many ems one image width was on the drawer's screen). */
export interface DrawFrame { readonly box: { readonly w: number; readonly h: number }; readonly imageEms: readonly number[] }

/**
 * The layout's figures, in ems of the post's text. Each is taken from the CSS it names, rounded up, or is an allowance with its reason.
 */
export const FRAME = {
  /** A character's width: the draft's own word box (instances' graffiti draft, WORD_EM 0.55), Verdana's average for running text. */
  charEm: 0.55,
  /** A character outside Latin, Greek and Cyrillic (CJK, emoji): about a whole em, and an emoji's fallback font is wider. */
  wideEm: 1.2,
  /** The board's line height (engine/ui/tokens.css `--kb-line`). */
  lineEm: 1.45,
  /** Words do not fill a line: a line breaks before the word that does not fit. Lines are counted at this share of the width. */
  fill: 0.8,
  /** The text's share of the box's width: the body's padding is 1% a side on a wide screen and 3% on a narrow one (thread.css). */
  textShare: 0.94,
  /** `[size=n]`'s scale (engine/ui/bbcode/bbcode.css `.kb-bb-size-n`); a smaller size is laid out at full size. */
  sizes: [1, 1, 1, 1, 1.2, 1.5, 2, 2.5] as readonly number[],
  /** The body's least height, 22.5em, with its 0.5em of padding top and bottom (thread.css). */
  floorEm: 23.5,
  /** The padding, and the engine's lines in the body: Last edited, a ruling's tag, a moderator's notice, a card's note under the words. */
  chromeEm: 12,
  /** An image is at most the text's width wide, and this many times as tall as that: a phone's screenshot is about 2.2, a long infographic or a comic strip up to 8. */
  imageTall: 8,
  /** A video is a 16:9 box at most 40rem wide (bbcode.css `.kb-bb-video`, 42.7em of the post's 0.9375rem), with its border, its source line and margins. */
  videoMostEm: 42.7, videoEm: 4,
  /** A quote's or a spoiler's box: its head, its border, 0.3em of padding and 0.4em of margin top and bottom; inside it, 2% a side less width. */
  boxEm: 3.5, boxInset: 0.96,
  /** A code block: one line a line of code (it scrolls, never wraps), its padding, border, margin and a scrollbar. */
  codeEm: 3,
  /** A list: 0.4em of margin top and bottom, its items 2em in. */
  listEm: 1, listInEm: 2,
  /** A rule: 1px and 0.6em of margin top and bottom; a cut quote's note: a line in a box. */
  hrEm: 1.5, cutEm: 3,
  /** The signature: its dashed rule, 0.8em of margin and 0.3em of padding; its words are laid out at full size, though they are drawn smaller. */
  signatureEm: 1.5,
  /** A poll (engine/ui/polls/poll.css): at most 34em wide; each option a row with its bar and count; its legend, button and totals. */
  pollMostEm: 34, pollRowEm: 2.6, pollEm: 9,
  /** The reactions row wraps (reactions.css): a chip with its count is under 4.5em wide and its row 2.4em tall; a card may add its own chips and a line under the row. */
  chipEm: 4.5, chipRowEm: 2.4, chipsMore: 8, reactionsEm: 4,
  /** What is left over, on top of the estimate: a share of it and a number of ems. */
  slackShare: 0.25, slackEm: 10,
  /** How far an image group's `em` may pass its box's width: the two are rounded to hundredths apart. */
  imageEpsilon: 0.02,
} as const;

const wide = (cp: number) => cp >= 0x1100;

/** The height, in ems, of BBCode laid out in lines `w` ems wide. */
function heightOf(nodes: readonly BbNode[], w: number): number {
  let h = 0;
  // The paragraph being laid: its width so far and its tallest line.
  let run = 0, line = 0;
  const flush = () => {
    if (line > 0) h += Math.max(1, Math.ceil(run / (Math.max(1, w) * FRAME.fill))) * line;
    run = 0; line = 0;
  };
  const text = (s: string, size: number) => {
    for (const ch of s) {
      if (ch === '\n') { if (line === 0) line = FRAME.lineEm * size; flush(); continue; }
      run += (wide(ch.codePointAt(0)!) ? FRAME.wideEm : FRAME.charEm) * size;
      line = Math.max(line, FRAME.lineEm * size);
    }
  };
  const block = (extra: number, inner?: () => number) => { flush(); h += extra + (inner ? inner() : 0); };
  // An explicit stack, as anchor.ts walks: a parse is at most MAX_DEPTH deep, and a body may hold many nodes.
  type Frame = { readonly nodes: readonly BbNode[]; i: number; readonly size: number };
  const walk = (list: readonly BbNode[], size: number) => {
    const stack: Frame[] = [{ nodes: list, i: 0, size }];
    while (stack.length) {
      const f = stack[stack.length - 1]!;
      if (f.i >= f.nodes.length) { stack.pop(); continue; }
      const n = f.nodes[f.i++]!;
      switch (n.type) {
        case 'text': case 'noparse': case 'autolink': text(n.text, f.size); break;
        case 'size': stack.push({ nodes: n.children, i: 0, size: Math.max(f.size, FRAME.sizes[n.size] ?? 1) }); break;
        case 'img': block(w * FRAME.imageTall + FRAME.lineEm); break;
        case 'video': block(Math.min(w, FRAME.videoMostEm) * (9 / 16) + FRAME.videoEm); break;
        case 'quote': case 'counterfeit': case 'spoiler': block(FRAME.boxEm, () => heightOf(n.children, w * FRAME.boxInset - 0.2)); break;
        case 'code': block(FRAME.codeEm + n.text.split('\n').length * FRAME.lineEm); break;
        case 'list': block(FRAME.listEm, () => n.items.reduce((s, item) => s + heightOf(item, w - FRAME.listInEm), 0)); break;
        case 'hr': block(FRAME.hrEm); break;
        case 'cut': block(FRAME.cutEm); break;
        case 'align': flush(); stack.push({ nodes: [...n.children, { type: 'text', text: '\n' }], i: 0, size: f.size }); break;
        default: if ('children' in n) stack.push({ nodes: n.children, i: 0, size: f.size });
      }
    }
  };
  walk(nodes, 1);
  flush();
  return h;
}

const laid = (bbcode: string, w: number, forged?: ReadonlySet<string>) => heightOf(parse(bbcode, undefined, forged), w);

/**
 * The tallest box, in ems, that the post's content area could honestly be at a box `w` ems wide: the estimate of its tallest version with its
 * signature, poll and reactions, never under the body's least height, plus the slack.
 */
export function tallestBox(post: PostFrame, w: number): number {
  const text = Math.max(1, w * FRAME.textShare);
  const words = Math.max(0, ...post.versions.map((v) => laid(v.body, text, v.forged)));
  const signature = post.signature && post.signature.trim() !== '' ? FRAME.signatureEm + laid(post.signature, text) : 0;
  const pollW = Math.min(text, FRAME.pollMostEm);
  const poll = post.poll
    ? FRAME.pollEm + laid(post.poll.question, pollW) + post.poll.options.reduce((s, o) => s + Math.max(FRAME.pollRowEm, laid(o, pollW) + 1.2), 0)
    : 0;
  const reactions = FRAME.reactionsEm + Math.ceil(((post.reactions + FRAME.chipsMore) * FRAME.chipEm) / text) * FRAME.chipRowEm;
  const estimate = Math.max(FRAME.floorEm, FRAME.chromeEm + words + signature + poll + reactions);
  return estimate * (1 + FRAME.slackShare) + FRAME.slackEm;
}

/** Which bound a declared frame passes, if any: `box.h` taller than the post could lay out at `box.w`, or an image group wider than its box. */
export function frameProblem(post: PostFrame, frame: DrawFrame): 'tall' | 'image' | null {
  if (frame.imageEms.some((em) => !(em <= frame.box.w + FRAME.imageEpsilon))) return 'image';
  if (!(frame.box.h <= tallestBox(post, frame.box.w))) return 'tall';
  return null;
}
