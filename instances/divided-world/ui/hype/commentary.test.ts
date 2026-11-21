/**
 * The commentary video's script, exactly as docs/plans/2026-11-21-commentary-video-design.md (section 4) words it:
 * eleven nodes in order, each caption at most 90 characters (two rows), and the end card's sentence with WROLD in it.
 * The captions of a node, joined with single spaces, are the node's full text, so a dropped or altered caption fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentary, TITLE, TITLE_NOTE } from './commentary.ts';

const SCRIPT: readonly { id: string; part: number; text: string; firstSix: string }[] = [
  {
    id: 'n01',
    part: 1,
    text: "Hi, I'm Gabe. Over the last few years, people have been asking me what our company has been up to. Why haven't we been making any games? Well, I'm happy to announce that the indefinite delay of Half-Life: Nuts & Bolts has not been in vain. For the last nine years, we've been putting all of our resources into this: Divided World. And nobody can ever get that time back. To listen to a commentary node, put your cursor over the floating commentary symbol and click. To stop one, click it again. Some commentary nodes may take temporary control over the forum in order to show you something. It's best to just let those ones happen.",
    firstSix: "Hi, I'm Gabe. Over the last",
  },
  {
    id: 'n02',
    part: 1,
    text: 'Early playtests showed us that people posting on a forum want to be liked. We found this resulted in a positive, nurturing environment - So instead, every character has a secret class, and some classes are paid for being disliked. This one is a Heel. Playtesters threw tomatoes at him and he made money. We then found they could hurt him by agreeing with him, politely. And that REALLY got him going!',
    firstSix: 'Early playtests showed us that people',
  },
  {
    id: 'n03',
    part: 1,
    text: "Sometimes we need to stop a player from doing something. In our other games we use what we call a gate. Here, the gate is another player. Every card back looks the same, so you can't know what's waiting on a post. Playtesters described this as unfair.",
    firstSix: 'Sometimes we need to stop a',
  },
  {
    id: 'n04',
    part: 1,
    text: 'I understand there may be some concerns that vibe coding was used on this project. I want to assure you that all vibes were completely negative, and that the requisite amount of human suffering for a project to count as art was achieved. In fact, it was exceeded, and I personally saw to it that that was the case.',
    firstSix: 'I understand there may be some',
  },
  {
    id: 'n05',
    part: 2,
    text: 'This is a training arc. The player learns that a card can be caught, and then learns that being caught can be the plan. We found 1 in 5 players understood this. He took the other four for everything they had, and none of them ever logged in again.',
    firstSix: 'This is a training arc. The',
  },
  {
    id: 'n06',
    part: 2,
    text: 'A card can be set to go off when somebody says a particular phrase. This trains players to choose their words carefully, which, on a forum, we think is new.',
    firstSix: 'A card can be set to',
  },
  {
    id: 'n07',
    part: 2,
    text: "Each player has several characters, and no other player can see which are theirs. So the argument you've been watching is, I think, mostly, one person. That's, um. There seem to be more nodes than we shipped.",
    firstSix: 'Each player has several characters, and',
  },
  {
    id: 'n08',
    part: 2,
    text: "Some commentary nodes may take control of the forum in order to show something to you. In these cases, simply click again to stop the— I'm clicking it.",
    firstSix: 'Some commentary nodes may take control',
  },
  {
    id: 'n09',
    part: 3,
    text: "So the, the way we think about this is, any time you do something new there's a normal distribution of pain, and this is— that's a chair. This is not in the middle of the curve. Okay. This is... somebody's post continuing itself? I guess? Okay, I'm hoping at one point one of the, uh...",
    firstSix: 'So the, the way we think',
  },
  {
    id: 'n10',
    part: 3,
    text: "Okay good, here's a Moderator. He's a personality core we pulled out of a pile, he should be able to clean some of this up, aaand.... he's merging all the boards together.",
    firstSix: "Okay good, here's a Moderator. He's",
  },
  {
    id: 'n11',
    part: 3,
    text: 'Please let me know... what you think.... after you\'ve had a chance.... to figure this stupid thing out!',
    firstSix: 'Please let me know... what you',
  },
];

test('the script has eleven nodes, n01 to n11, in order, in parts one to three', () => {
  assert.deepEqual(commentary.map((n) => n.id), SCRIPT.map((s) => s.id));
  assert.deepEqual(commentary.map((n) => n.part), SCRIPT.map((s) => s.part));
});

test('each node opens with the design\'s first six words, so a dropped or reworded node fails by name', () => {
  const table = commentary.map((n) => [n.id, n.lines.join(' ').split(' ').slice(0, 6).join(' ')]);
  const expected = SCRIPT.map((s) => [s.id, s.firstSix]);
  assert.deepEqual(table, expected);
});

test('the captions of each node, joined with single spaces, are the node\'s full text', () => {
  for (const s of SCRIPT) {
    const node = commentary.find((n) => n.id === s.id);
    assert.ok(node, `node ${s.id} is missing`);
    assert.equal(node.lines.join(' '), s.text, `node ${s.id} does not match the design's words`);
  }
});

test('no caption is longer than 90 characters, and none is empty', () => {
  for (const n of commentary) {
    assert.ok(n.lines.length > 0, `node ${n.id} has no lines`);
    for (const line of n.lines) {
      assert.ok(line.length > 0, `node ${n.id} has an empty line`);
      assert.ok(line.length <= 90, `node ${n.id} has a line of ${line.length} characters: "${line}"`);
    }
  }
});

test('no caption says "The System" or "nobody can see"', () => {
  for (const n of commentary) {
    for (const line of n.lines) {
      assert.ok(!/the system/i.test(line), `node ${n.id} says "The System": "${line}"`);
      assert.ok(!/nobody can see/i.test(line), `node ${n.id} says "nobody can see": "${line}"`);
    }
  }
});

test('node 11 has exactly its four fragments, one to a line', () => {
  const n11 = commentary.find((n) => n.id === 'n11');
  assert.ok(n11, 'node n11 is missing');
  assert.deepEqual(n11.lines, ['Please let me know...', 'what you think....', "after you've had a chance....", 'to figure this stupid thing out!']);
});

test('the title is DIVIDED WROLD, and its note is the owner\'s parenthetical to the letter', () => {
  assert.equal(TITLE, 'DIVIDED WROLD');
  assert.equal(TITLE_NOTE, "(misspelled) (put the misspelled word 'world' in there for real)");
});
