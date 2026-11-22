/**
 * The commentary video's script, exactly as docs/plans/2026-11-21-commentary-video-revision-design.md (section 11)
 * words it: the nodes in order, each caption at most 90 characters (two rows), the captions of a node joined with
 * single spaces equal its text (so a dropped or altered caption fails), v11's caption without the sigh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentary, captionLines, TITLE, TITLE_TAG } from './commentary.ts';

const SCRIPT: readonly { id: string; part: number; text: string; firstSix: string }[] = [
  { id: 'v01', part: 1, firstSix: "Hi, I'm Gabe. Over the last", text: "Hi, I'm Gabe. Over the last few years, people have been asking me what our company has been up to. Why haven't we been making any games? Well, I'm happy to announce that the indefinite delay of Half-Life: Nuts & Bolts has not been in vain. For the last nine years, we've been putting all of our resources into this: Divided World. And since we'll never get any of that time back, let's dive right in." },
  { id: 'v02', part: 1, firstSix: 'Here we see a straightforward MFGG', text: "Here we see a straightforward MFGG submission with a solid 2.9 star rating trajectory. You're probably wondering how something so earnest and innocuous could possibly end up starting a vicious fight: and that's exactly the kind of game design problem we set out to solve." },
  { id: 'v03', part: 1, firstSix: 'See, one of the first things', text: 'See, one of the first things we found in playtesting is that human beings enjoy being Liked. Among a population of well-adjusted adults, this tends to result in a positive nurturing environment.' },
  { id: 'v04', part: 1, firstSix: 'So to fix that, we gave', text: 'So to fix that, we gave every character an anonymous class: And some of the classes get points for being DISliked.' },
  { id: 'v05', part: 1, firstSix: "Take this guy: he's a Heel.", text: "Take this guy: he's a Heel. He made this piece-of-shit post, and the crowd threw tomatoes at him. Normally this would be a bad thing, but for a Heel, it gives him Aura. The flip side is that if you agree with him politely, he actually LOSES Aura. We tried that out and he lost his MIND, heh, check this out:" },
  { id: 'v06', part: 1, firstSix: 'Problem solved.', text: 'Problem solved.' },
  { id: 'v07', part: 1, firstSix: 'These are the six classes: Face,', text: 'These are the six classes: Face, Heel, Jabroni, Technician, Tweener, and Lurker. You get six characters, so you can try all of them if you want.' },
  { id: 'v08', part: 1, firstSix: 'They all share the same aura,', text: 'They all share the same aura, so you can farm reactions as one class to power up another class.' },
  { id: 'v09', part: 1, firstSix: 'The aura gets spent on cards', text: 'The aura gets spent on cards at the vending machine, and the characters play those to earn even more reactions. In the biz we call that a "gameplay loop".' },
  { id: 'v10a', part: 2, firstSix: 'Okay, this is, uh...yeah, we call', text: 'Okay, this is, uh...yeah, we call this a training arc. A card can be face down on any post, the poster can set conditions for it to spring, so other players learn to uh, to not trust anybody, basically.' },
  { id: 'v10b', part: 2, firstSix: 'Sometimes the player plays a card', text: "Sometimes the player plays a card and then it turns out the player you played the card on actually WANTED you to play that card, so you really should've played a different card, or just not played any card at all. And uh, you get some really interesting conversations, at the end of the day. It's a positive experience. We tested this. The testers...okay, I'll level with you, this is the first time we've really tested it." },
  { id: 'v10c', part: 2, firstSix: 'And you know, what do you', text: 'And you know, what do you know, anyway?! You sit there on your gaming chair and you expect everything handed to you on a silver platter.' },
  { id: 'v10d', part: 2, firstSix: 'Making games is hard! Being Gabe,', text: 'Making games is hard! Being Gabe, is hard! I don\'t have to give my "commentary" to you! This is a good idea! THIS IS A GOOD IDEA! THIS IS A GOOD IDEA!!!' },
  { id: 'v11', part: 3, firstSix: "*sigh* This is a bad idea.", text: "*sigh* This is a bad idea." },
];

test('the script is v01 to v09, v10a to v10d, v11, in order, in the calm, frantic and end parts', () => {
  assert.deepEqual(commentary.map((n) => n.id), SCRIPT.map((s) => s.id));
  assert.deepEqual(commentary.map((n) => n.part), SCRIPT.map((s) => s.part));
});

test("each node opens with the design's first six words, so a dropped or reworded node fails by name", () => {
  const table = commentary.map((n) => [n.id, n.lines.join(' ').split(' ').slice(0, 6).join(' ')]);
  assert.deepEqual(table, SCRIPT.map((s) => [s.id, s.firstSix]));
});

test("the lines of each node, joined with single spaces, are the node's full text", () => {
  for (const s of SCRIPT) {
    const node = commentary.find((n) => n.id === s.id);
    assert.ok(node, `node ${s.id} is missing`);
    assert.equal(node.lines.join(' '), s.text, `node ${s.id} does not match the design's words`);
  }
});

test('no caption is longer than 90 characters, and none is empty', () => {
  for (const n of commentary) {
    assert.ok(n.lines.length > 0, `node ${n.id} has no lines`);
    for (const line of [...n.lines, ...captionLines(n)]) {
      assert.ok(line.length > 0, `node ${n.id} has an empty line`);
      assert.ok(line.length <= 90, `node ${n.id} has a line of ${line.length} characters: "${line}"`);
    }
  }
});

test('lines are split only at punctuation or a sentence end, so each line but a node\'s last ends in punctuation', () => {
  for (const n of commentary) {
    n.lines.slice(0, -1).forEach((l) => {
      if (n.id === 'v01' || n.id === 'v02' || n.id === 'v03' || n.id === 'v10b' || n.id === 'v10c') return;
      assert.match(l, /[.,:!?]$/, `node ${n.id}: "${l}" ends mid-clause`);
    });
  }
});

test('the only pauses are v01 (the opening silence, 0) and v06 (4.5 s of angry typing); every other node takes the usual breath', () => {
  assert.deepEqual(commentary.filter((x) => x.after !== undefined).map((x) => [x.id, x.after]), [['v01', 0], ['v06', 4.5]]);
});

test('v11 says the sigh and does not caption it; captions drop any *stage direction* elsewhere too', () => {
  const v11 = commentary.find((n) => n.id === 'v11');
  assert.ok(v11);
  assert.equal(v11.lines.join(' '), "*sigh* This is a bad idea.");
  assert.deepEqual(captionLines(v11), ["This is a bad idea."]);
  assert.deepEqual(captionLines({ id: 'x', part: 1, lines: ['*cough* Hello.', '*pause*'] }), ['Hello.']);
  for (const n of commentary.filter((x) => x.id !== 'v11')) assert.deepEqual(captionLines(n), n.lines);
});

test('no caption says "The System" or "nobody can see"', () => {
  for (const n of commentary) for (const line of n.lines) {
    assert.ok(!/the system/i.test(line), `node ${n.id} says "The System": "${line}"`);
    assert.ok(!/nobody can see/i.test(line), `node ${n.id} says "nobody can see": "${line}"`);
  }
});

test('the title is DIVIDED WORLD with the tag INVITE ONLY, spelled right', () => {
  assert.equal(TITLE, 'DIVIDED WORLD');
  assert.equal(TITLE_TAG, 'INVITE ONLY');
});
