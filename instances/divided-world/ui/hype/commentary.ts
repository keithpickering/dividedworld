/**
 * The commentary video's script as data: the narration of docs/plans/2026-11-21-commentary-video-revision-design.md
 * (section 11, the owner's rewrite on the sixth cut), to the letter. Each node is a list of lines; each line fits two
 * caption rows (at most 90 characters) and is split only at a comma, a dash, a colon or a full stop. Joined with single
 * spaces, a node's lines are its full spoken text. A `*stage direction*` in the spoken text is performed and not
 * captioned: `captionLines` drops it, or a node's own `caption` replaces its lines on screen.
 */

export interface Node {
  readonly id: string;
  /** 1 is the calm opening (v01 to v09), 2 the frantic part (v10a to v10d), 3 the end (v11). */
  readonly part: 1 | 2 | 3;
  /** What is spoken, one caption row-pair to a line. */
  readonly lines: readonly string[];
  /** Seconds of silence before the node, where it is not the usual breath (v01: the recording's opening silence; v06: the angry typing). */
  readonly after?: number;
  /** What the screen shows where it differs from what is said (v11 omits the sigh). */
  readonly caption?: readonly string[];
}

/** The lines a viewer reads: the node's `caption` if it has one, else its spoken lines without any `*stage direction*`. */
export function captionLines(node: Node): readonly string[] {
  if (node.caption) return node.caption;
  return node.lines.map((l) => l.replace(/\*[^*]*\*\s*/g, '').trim()).filter((l) => l.length > 0);
}

export const commentary: readonly Node[] = [
  {
    id: 'v01',
    part: 1,
    after: 0,
    lines: [
      "Hi, I'm Gabe.",
      'Over the last few years, people have been asking me what our company has been up to.',
      "Why haven't we been making any games?",
      "Well, I'm happy to announce that the indefinite delay of Half-Life: Nuts & Bolts",
      'has not been in vain.',
      "For the last nine years, we've been putting all of our resources into this:",
      'Divided World.',
      "And since we'll never get any of that time back,",
      "let's dive right in.",
    ],
  },
  {
    id: 'v02',
    part: 1,
    lines: [
      'Here we see a straightforward MFGG submission with a solid 2.9 star rating trajectory.',
      "You're probably wondering how something so earnest and innocuous",
      "could possibly end up starting a vicious fight:",
      "and that's exactly the kind of game design problem we set out to solve.",
    ],
  },
  {
    id: 'v03',
    part: 1,
    lines: [
      'See, one of the first things we found in playtesting',
      'is that human beings enjoy being Liked.',
      'Among a population of well-adjusted adults,',
      'this tends to result in a positive nurturing environment.',
    ],
  },
  {
    id: 'v04',
    part: 1,
    lines: [
      'So to fix that, we gave every character an anonymous class:',
      'And some of the classes get points for being DISliked.',
    ],
  },
  {
    id: 'v05',
    part: 1,
    lines: [
      "Take this guy: he's a Heel.",
      'He made this piece-of-shit post, and the crowd threw tomatoes at him.',
      'Normally this would be a bad thing, but for a Heel, it gives him Aura.',
      'The flip side is that if you agree with him politely, he actually LOSES Aura.',
      'We tried that out and he lost his MIND, heh,',
      'check this out:',
    ],
  },
  {
    id: 'v06',
    part: 1,
    after: 4.5,
    lines: ['Problem solved.'],
  },
  {
    id: 'v07',
    part: 1,
    lines: [
      'These are the six classes:',
      'Face, Heel, Jabroni, Technician, Tweener, and Lurker.',
      'You get six characters,',
      'so you can try all of them if you want.',
    ],
  },
  {
    id: 'v08',
    part: 1,
    lines: [
      'They all share the same aura,',
      'so you can farm reactions as one class to power up another class.',
    ],
  },
  {
    id: 'v09',
    part: 1,
    lines: [
      'The aura gets spent on cards at the vending machine,',
      'and the characters play those to earn even more reactions.',
      'In the biz we call that a "gameplay loop".',
    ],
  },
  {
    id: 'v10a',
    part: 2,
    lines: [
      'Okay, this is, uh...yeah, we call this a training arc.',
      'A card can be face down on any post,',
      'the poster can set conditions for it to spring,',
      'so other players learn to uh, to not trust anybody, basically.',
    ],
  },
  {
    id: 'v10b',
    part: 2,
    lines: [
      'Sometimes the player plays a card and then it turns out',
      'the player you played the card on actually WANTED you to play that card,',
      "so you really should've played a different card,",
      'or just not played any card at all.',
      'And uh, you get some really interesting conversations,',
      'at the end of the day.',
      "It's a positive experience.",
      'We tested this.',
      "The testers...okay, I'll level with you,",
      "this is the first time we've really tested it.",
    ],
  },
  {
    id: 'v10c',
    part: 2,
    lines: [
      'And you know, what do you know, anyway?!',
      'You sit there on your gaming chair',
      'and you expect everything handed to you on a silver platter.',
    ],
  },
  {
    id: 'v10d',
    part: 2,
    lines: [
      'Making games is hard!',
      'Being Gabe, is hard!',
      'I don\'t have to give my "commentary" to you!',
      'This is a good idea!',
      'THIS IS A GOOD IDEA!',
      'THIS IS A GOOD IDEA!!!',
    ],
  },
  {
    id: 'v11',
    part: 3,
    lines: ['*sigh* Well, at least it\'s better than anime.'],
    caption: ["Well, at least it's better than anime."],
  },
];

export const TITLE = 'DIVIDED WORLD';
export const TITLE_TAG = 'INVITE ONLY';

/**
 * @deprecated The title card has no note any more; read TITLE and TITLE_TAG. Kept as '' only because
 * tools/hype/shot-commentary-end.mjs and tools/hype/edit-commentary.mjs (files this module's author does not own)
 * still import it; their owners remove it, and this export goes with them.
 */
export const TITLE_NOTE = '';
