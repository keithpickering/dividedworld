/**
 * The commentary video's script as data, the words of docs/plans/2026-11-21-commentary-video-design.md (section 4, as the owner reworded it in section 9),
 * to the letter. Each node is a list of captions; each caption fits two rows (at most 90 characters) and is split only
 * at a comma, a dash or a full stop. Joined with single spaces, a node's captions are its full text.
 */

export interface Node {
  readonly id: string;
  readonly part: 1 | 2 | 3;
  readonly lines: readonly string[];
}

export const commentary: readonly Node[] = [
  {
    id: 'n01',
    part: 1,
    lines: [
      "Hi, I'm Gabe.",
      'Over the last few years, people have been asking me what our company has been up to.',
      "Why haven't we been making any games?",
      "Well, I'm happy to announce that the indefinite delay of Half-Life: Nuts & Bolts",
      'has not been in vain.',
      "For the last nine years, we've been putting all of our resources into this:",
      'Divided World.',
      'And nobody can ever get that time back.',
      'To listen to a commentary node,',
      'put your cursor over the floating commentary symbol and click.',
      'To stop one, click it again.',
      'Some commentary nodes may take temporary control over the forum',
      'in order to show you something.',
      "It's best to just let those ones happen.",
    ],
  },
  {
    id: 'n02',
    part: 1,
    lines: [
      'Early playtests showed us that people posting on a forum want to be liked.',
      'We found this resulted in a positive, nurturing environment -',
      'So instead, every character has a secret class,',
      'and some classes are paid for being disliked.',
      'This one is a Heel.',
      'Playtesters threw tomatoes at him and he made money.',
      'We then found they could hurt him by agreeing with him, politely.',
      'And that REALLY got him going!',
    ],
  },
  {
    id: 'n03',
    part: 1,
    lines: [
      'Sometimes we need to stop a player from doing something.',
      'In our other games we use what we call a gate.',
      'Here, the gate is another player.',
      "Every card back looks the same, so you can't know what's waiting on a post.",
      'Playtesters described this as unfair.',
    ],
  },
  {
    id: 'n04',
    part: 1,
    lines: [
      'I understand there may be some concerns that vibe coding was used on this project.',
      'I want to assure you that all vibes were completely negative,',
      // Split by the word, not by punctuation: the design's sentence has no comma between "human suffering" and
      // "achieved", and the clause alone is 92 characters.
      'and that the requisite amount of human suffering for a project',
      'to count as art was achieved.',
      'In fact, it was exceeded, and I personally saw to it that that was the case.',
    ],
  },
  {
    id: 'n05',
    part: 2,
    lines: [
      'This is a training arc.',
      'The player learns that a card can be caught,',
      'and then learns that being caught can be the plan.',
      'We found 1 in 5 players understood this.',
      'He took the other four for everything they had,',
      'and none of them ever logged in again.',
    ],
  },
  {
    id: 'n06',
    part: 2,
    lines: [
      'A card can be set to go off when somebody says a particular phrase.',
      'This trains players to choose their words carefully,',
      'which, on a forum, we think is new.',
    ],
  },
  {
    id: 'n07',
    part: 2,
    lines: [
      'Each player has several characters, and no other player can see which are theirs.',
      'So the argument you\'ve been watching is, I think, mostly, one person.',
      "That's, um.",
      'There seem to be more nodes than we shipped.',
    ],
  },
  {
    id: 'n08',
    part: 2,
    lines: [
      'Some commentary nodes may take control of the forum in order to show something to you.',
      'In these cases, simply click again to stop the—',
      "I'm clicking it.",
    ],
  },
  {
    id: 'n09',
    part: 3,
    lines: [
      'So the, the way we think about this is,',
      "any time you do something new there's a normal distribution of pain,",
      "and this is— that's a chair.",
      'This is not in the middle of the curve. Okay.',
      "This is... somebody's post continuing itself?",
      'I guess?',
      "Okay, I'm hoping at one point one of the, uh...",
    ],
  },
  {
    id: 'n10',
    part: 3,
    lines: [
      "Okay good, here's a Moderator.",
      "He's a personality core we pulled out of a pile,",
      'he should be able to clean some of this up, aaand....',
      "he's merging all the boards together.",
    ],
  },
  {
    id: 'n11',
    part: 3,
    lines: [
      'Please let me know...',
      'what you think....',
      "after you've had a chance....",
      'to figure this stupid thing out!',
    ],
  },
];

export const TITLE = 'DIVIDED WROLD';
export const TITLE_NOTE = "(misspelled) (put the misspelled word 'world' in there for real)";

/**
 * @deprecated Read TITLE and TITLE_NOTE. The last reader is tools/hype/edit-commentary.mjs (and its test); the agent
 * that owns that file removes it, and this export goes with it.
 */
export const END_CARD = TITLE + ' ' + TITLE_NOTE;
