import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME, frameProblem, tallestBox, type PostFrame } from './frame.ts';

/*
 * The boxes below were measured in Chromium on the app (the e2e build on the fake), as Compose measures them (draft.ts / Compose.tsx: the post body's
 * clientWidth and clientHeight over its text size, in ems), for post #2 of the demo thread with each body below, at a 320px and a 1600px window and at
 * the smallest (100%) and the largest (200%) text size Settings offers (engine/ui/account/appearanceRows.tsx, TEXT_SIZE). The demo character has no
 * signature and the post no poll. The tall image is 600 x 2400.
 */
const LONG = Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}. ` + 'The quick brown fox jumps over the lazy dog while everyone on the board argues about whether the sprite sheet is any good at all. '.repeat(3)).join('\n\n');
const TALL = 'Look at this comic:\n[img]https://img.test/tall.svg[/img]\nWow, right?';
const CAPS = 'WHY DOES EVERYONE KEEP REACTING WITH A THUMBS UP ON MY POSTS, I DEMAND ANSWERS FROM THE MODERATORS RIGHT NOW. '.repeat(10);
const SIZE7 = '[size=7]' + 'Huge words for everyone to see on the board today. '.repeat(6) + '[/size]';
const QUOTES = '[quote]'.repeat(6) + 'deep words that everyone said about the sprite sheet and its fingers. '.repeat(3) + '[/quote]'.repeat(6) + '\nme too';
const MIXED = '[list][*]one thing to say[*]two things to say about this[*]three[/list]\n[code]a\nb\nc\nd[/code]\n[hr]\n[spoiler]hidden words here that are long enough to wrap a few times on a phone screen at least[/spoiler]\n[center]centered[/center]';
const EMOJI = '💪😂🍅🔥'.repeat(40) + '\n日本語のテキストもあります。'.repeat(10);
/** The front door's post #1 (instances/divided-world/ui/front-door.ts, SHEET_BODY), with its sprite sheet (188 x 390) at an https address, as production serves it. */
const SHEET = "Hi divided world, it's ya boy Snuckles here with my first ever sprite sheet. He's an original character I invented after I saw him in a Mario game.\n\n[img]https://dw.example/sheet.png[/img]\n\nLet me know what you think!";

type Box = { readonly w: number; readonly h: number };
const MEASURED: readonly (readonly [name: string, body: string, at: string, box: Box])[] = [
  ['long text', LONG, '320px 100%', { w: 20.33, h: 152.2 }], ['long text', LONG, '320px 200%', { w: 10.17, h: 304.37 }],
  ['long text', LONG, '1600px 100%', { w: 65.8, h: 59.4 }], ['long text', LONG, '1600px 200%', { w: 31.9, h: 94.23 }],
  ['tall image', TALL, '320px 100%', { w: 20.33, h: 82.73 }], ['tall image', TALL, '320px 200%', { w: 10.17, h: 45.73 }],
  ['tall image', TALL, '1600px 100%', { w: 65.8, h: 166.2 }], ['tall image', TALL, '1600px 200%', { w: 31.9, h: 86.17 }],
  ['capitals', CAPS, '320px 100%', { w: 20.33, h: 60.87 }], ['capitals', CAPS, '320px 200%', { w: 10.17, h: 120.2 }],
  ['capitals', CAPS, '1600px 100%', { w: 65.8, h: 23.53 }], ['capitals', CAPS, '1600px 200%', { w: 31.9, h: 37.67 }],
  ['size 7', SIZE7, '320px 100%', { w: 20.33, h: 89.87 }], ['size 7', SIZE7, '320px 200%', { w: 10.17, h: 199.97 }],
  ['size 7', SIZE7, '1600px 100%', { w: 65.8, h: 28.27 }], ['size 7', SIZE7, '1600px 200%', { w: 31.9, h: 53.63 }],
  ['six quotes deep', QUOTES, '320px 100%', { w: 20.33, h: 33.73 }], ['six quotes deep', QUOTES, '320px 200%', { w: 10.17, h: 45.23 }],
  ['six quotes deep', QUOTES, '1600px 100%', { w: 65.8, h: 26.53 }], ['six quotes deep', QUOTES, '1600px 200%', { w: 31.9, h: 29.4 }],
  ['a list, code, a rule, a spoiler', MIXED, '320px 100%', { w: 20.33, h: 27.2 }], ['a list, code, a rule, a spoiler', MIXED, '320px 200%', { w: 10.17, h: 31.4 }],
  ['a list, code, a rule, a spoiler', MIXED, '1600px 100%', { w: 65.8, h: 27.2 }], ['a list, code, a rule, a spoiler', MIXED, '1600px 200%', { w: 31.9, h: 27.17 }],
  ['emoji and Japanese', EMOJI, '320px 100%', { w: 20.33, h: 33.33 }], ['emoji and Japanese', EMOJI, '320px 200%', { w: 10.17, h: 66.57 }],
  ['emoji and Japanese', EMOJI, '1600px 100%', { w: 65.8, h: 23.53 }], ['emoji and Japanese', EMOJI, '1600px 200%', { w: 31.9, h: 27.53 }],
  ['one line', 'hi', '320px 100%', { w: 20.33, h: 23.53 }], ['one line', 'hi', '320px 200%', { w: 10.17, h: 23.5 }],
  ['one line', 'hi', '1600px 100%', { w: 65.8, h: 23.53 }], ['one line', 'hi', '1600px 200%', { w: 31.9, h: 23.5 }],
  // The front door's own figure for its desktop box (front-door.ts, SHEET.box), and its phone boxes with the sheet at its 390px: 26 ems at 100%, 13 at 200%, under the words.
  ['the front door\'s post #1', SHEET, '1600px 100%', { w: 65.9, h: 38.5 }],
  ['the front door\'s post #1', SHEET, '320px 100%', { w: 20.33, h: 23.53 + 26 }], ['the front door\'s post #1', SHEET, '320px 200%', { w: 10.17, h: 30.5 + 13 }],
];
const postOf = (body: string, more: Partial<PostFrame> = {}): PostFrame => ({ versions: [{ body }], signature: '', poll: null, reactions: 16, ...more });
/** How far under its bound each honest box must lie: the measured boxes are one browser's fonts, and a player's may set the words wider. */
const ROOM = 1.5;

test('every honest box measured in the app is accepted, with room to spare, at the narrowest width and the largest text alike', () => {
  for (const [name, body, at, box] of MEASURED) {
    const post = postOf(body);
    assert.equal(frameProblem(post, { box, imageEms: [] }), null, `${name} at ${at}`);
    assert.ok(tallestBox(post, box.w) >= box.h * ROOM, `${name} at ${at}: ${box.h} ems against a bound of ${tallestBox(post, box.w).toFixed(1)}`);
  }
});

test('the reviewer\'s poison is refused: the same post declared 200 by 2,000 ems, or just under the 4,000 limit', () => {
  // A whole desktop post: the long text at 1600px, 65.8 by 59.4 ems. The poison's box is wider and far taller than any screen lays it out.
  const post = postOf(LONG);
  for (const box of [{ w: 65.8, h: 2000 }, { w: 5, h: 3999 }]) {
    assert.equal(frameProblem(post, { box, imageEms: [] }), 'tall', JSON.stringify(box));
  }
  for (const box of [{ w: 200, h: 2000 }, { w: 200, h: 3999 }]) {
    assert.equal(frameProblem(post, { box, imageEms: [] }), 'wide', JSON.stringify(box));
  }
});

test('a box wider than any content area is refused, however short: declaring 200 ems on a short post would count its tag about five times over', () => {
  // The widest honest box is the widest page at the smallest text size: base.css's `.kb-page` is 80rem at most, so at 100% text (15px a post em) a body is 65.8 ems, measured at 1280px and every width above; the front door's is 65.9.
  const short = postOf('hi');
  assert.equal(frameProblem(short, { box: { w: 200, h: 23.5 }, imageEms: [] }), 'wide');
  assert.equal(frameProblem(short, { box: { w: 200, h: 23.5 }, imageEms: [150] }), 'wide');
  assert.equal(frameProblem(short, { box: { w: FRAME.widestEm + 0.5, h: 23.5 }, imageEms: [] }), 'wide');
  for (const w of [65.8, 65.9, FRAME.widestEm]) assert.equal(frameProblem(short, { box: { w, h: 23.53 }, imageEms: [w] }), null, `${w} ems is honest`);
  assert.ok(FRAME.widestEm >= 65.9 && FRAME.widestEm <= 75, `the widest honest box with a small margin: ${FRAME.widestEm}`);
});

test('a box three times as tall as a post of words is refused, for a short post and a long one, at a phone\'s width and a desktop\'s', () => {
  // A post of Latin words alone; quotes, blocks, wide characters and images are laid out with more room (FRAME's allowances), since their layout is less certain.
  for (const [name, body, at, box] of MEASURED.filter(([, b]) => [LONG, CAPS, SIZE7, 'hi'].includes(b))) {
    assert.equal(frameProblem(postOf(body), { box: { w: box.w, h: box.h * 3 }, imageEms: [] }), 'tall', `${name} at ${at}`);
  }
});

test('an image group wider than its box is refused; one as wide as the box, to the hundredth either is rounded to, is not', () => {
  const post = postOf(TALL);
  const box = { w: 65.8, h: 166.2 };
  assert.equal(frameProblem(post, { box, imageEms: [40, 65.8] }), null);
  assert.equal(frameProblem(post, { box, imageEms: [65.8 + FRAME.imageEpsilon] }), null);
  assert.equal(frameProblem(post, { box, imageEms: [65.9] }), 'image');
  assert.equal(frameProblem(post, { box, imageEms: [400] }), 'image');
  assert.equal(frameProblem(post, { box: { w: 5, h: 30 }, imageEms: [0.5, 5.03] }), 'image');
});

test('what a post shows beside its words is laid out too: its signature, its poll, its tallest version, its reactions', () => {
  const w = 20.33;
  const bare = tallestBox(postOf('hi'), w);
  const sig = tallestBox(postOf('hi', { signature: `My sig ${'words '.repeat(80)}[img]https://dw.example/banner.png[/img]` }), w);
  assert.ok(sig > bare + w * FRAME.textShare * FRAME.imageTall, `a signature's words and its image (${sig.toFixed(1)} against ${bare.toFixed(1)})`);
  const poll = tallestBox(postOf('hi', { poll: { question: 'Which?', options: Array.from({ length: 40 }, (_, i) => `option ${i}`) } }), w);
  assert.ok(poll > bare + 40 * FRAME.pollRowEm, `forty options (${poll.toFixed(1)})`);
  // A live rewind shows an older version: the tallest one counts, whichever is current.
  assert.equal(tallestBox({ ...postOf('hi'), versions: [{ body: LONG }, { body: 'hi' }] }, w), tallestBox(postOf(LONG), w));
  assert.ok(tallestBox(postOf('hi', { reactions: 60 }), 10.17) > tallestBox(postOf('hi'), 10.17));
});

test('a post with no words at all (a version an admin hid reads as none) still takes the body\'s least height', () => {
  assert.equal(frameProblem(postOf(''), { box: { w: 10.17, h: 23.5 }, imageEms: [] }), null);
  assert.equal(frameProblem({ versions: [], reactions: 16 }, { box: { w: 65.8, h: 23.53 }, imageEms: [] }), null);
});
