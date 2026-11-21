/**
 * The commentary video's script, exactly as docs/plans/2026-11-21-commentary-video-design.md (section 4) words it:
 * eleven nodes in order, each caption at most 90 characters (two rows), and the end card's sentence with WROLD in it.
 * The captions of a node, joined with single spaces, are the node's full text, so a dropped or altered caption fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentary, END_CARD } from './commentary.ts';

const SCRIPT: readonly { id: string; part: number; text: string; firstSix: string }[] = [
  {
    id: 'n01',
    part: 1,
    text: "Hi, my name is Gabe, and welcome to Divided World. After nine years in development, hopefully it will have been worth the wait. The last forum ran on code I wrote when I was twenty, and it's not easy to open that up and wonder what you were thinking. This is, I think, better. To listen to a commentary node, put your cursor over the floating commentary symbol and click. To stop a commentary node, click it again. Some commentary nodes may take control of the forum in order to show something to you. In these cases, simply click again to stop the commentary.",
    firstSix: 'Hi, my name is Gabe, and',
  },
  {
    id: 'n02',
    part: 1,
    text: 'Early playtests showed that people on a forum want to be liked. We considered this a design problem. So every character has a secret class, and some classes are paid for being disliked. This one is a Heel. Playtesters threw tomatoes at him and he made money. We then found they could hurt him by agreeing with him, politely. We didn\'t design that. We kept it.',
    firstSix: 'Early playtests showed that people on',
  },
  {
    id: 'n03',
    part: 1,
    text: "Sometimes we need to stop a player from doing something. In our other games we use what we call a gate. Here, the gate is another player. Every card back looks the same, so you can't know what's waiting on a post. Playtesters described this as unfair. We agree.",
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
    text: 'This is a training arc. The player learns that a card can be caught, and then learns that being caught can be the plan. We found that about one playtester in five understood this. He won everything, and we couldn\'t work out who he was.',
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
    text: "So the, the way we think about this is, any time you do something new there's a normal distribution of pain, and this is— that's a chair. This is not in the middle of the curve. Okay. This is GPT-2 finishing someone's post. Do we... do we have a filter on that? My god, there are laws about this stuff, you know.",
    firstSix: 'So the, the way we think',
  },
  {
    id: 'n10',
    part: 3,
    text: "That's the moderator. He's a Personality Core, we found him in a pile, he's the permanent Boss, and nothing will go— he's merging the boards. To stop a commentary node, put your cursor over— I'm doing that.",
    firstSix: "That's the moderator. He's a Personality",
  },
  {
    id: 'n11',
    part: 3,
    text: 'Please let me know— —what you think— —after you have had a chance—',
    firstSix: 'Please let me know— —what you',
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

test('node 11 has exactly its three fragments, one to a line', () => {
  const n11 = commentary.find((n) => n.id === 'n11');
  assert.ok(n11, 'node n11 is missing');
  assert.deepEqual(n11.lines, ['Please let me know—', '—what you think—', '—after you have had a chance—']);
});

test('the end card keeps WROLD and not the correct spelling', () => {
  assert.ok(END_CARD.includes('WROLD'), 'END_CARD must contain WROLD');
  assert.ok(!END_CARD.includes('WORLD ('), 'END_CARD must not contain "WORLD ("');
  assert.equal(END_CARD, "DIVIDED WROLD (misspelled) (put the misspelled word 'world' in there for real)");
});
