/**
 * The commentary video's script as data, the words of docs/plans/2026-11-21-commentary-video-design.md (section 4),
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
      'Hi, my name is Gabe, and welcome to Divided World.',
      'After nine years in development, hopefully it will have been worth the wait.',
      'The last forum ran on code I wrote when I was twenty,',
      "and it's not easy to open that up and wonder what you were thinking.",
      'This is, I think, better.',
      'To listen to a commentary node,',
      'put your cursor over the floating commentary symbol and click.',
      'To stop a commentary node, click it again.',
      'Some commentary nodes may take control of the forum in order to show something to you.',
      'In these cases, simply click again to stop the commentary.',
    ],
  },
  {
    id: 'n02',
    part: 1,
    lines: [
      'Early playtests showed that people on a forum want to be liked.',
      'We considered this a design problem.',
      'So every character has a secret class, and some classes are paid for being disliked.',
      'This one is a Heel.',
      'Playtesters threw tomatoes at him and he made money.',
      'We then found they could hurt him by agreeing with him, politely.',
      "We didn't design that.",
      'We kept it.',
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
      'We agree.',
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
      'We found that about one playtester in five understood this.',
      "He won everything, and we couldn't work out who he was.",
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
      "This is GPT-2 finishing someone's post.",
      'Do we... do we have a filter on that?',
      'My god, there are laws about this stuff, you know.',
    ],
  },
  {
    id: 'n10',
    part: 3,
    lines: [
      "That's the moderator.",
      "He's a Personality Core, we found him in a pile, he's the permanent Boss,",
      "and nothing will go— he's merging the boards.",
      "To stop a commentary node, put your cursor over— I'm doing that.",
    ],
  },
  {
    id: 'n11',
    part: 3,
    lines: ['Please let me know—', '—what you think—', '—after you have had a chance—'],
  },
];

export const END_CARD = "DIVIDED WROLD (misspelled) (put the misspelled word 'world' in there for real)";
