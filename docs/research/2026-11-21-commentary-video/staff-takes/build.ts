// Builds the exact staff prompts for the Wiggler thread's missing lines, with the engine's own prompt builders and the
// field values the staff and chatter functions pass (supabase/functions/staff/core.ts, report.ts; chatter/core.ts).
// No model call happens here. Writes one JSON per call: { id, duty, tier, system, message, schema }.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { filingPrompt, reportPrompt } from '../../../../engine/system/judgment.ts';
import { chatterPrompt, chatterSchema, POOL_PREMISE } from '../../../../engine/system/chatter.ts';
import { PRONOUN_PRESETS } from '../../../../engine/rules/pronouns.ts';
import { instance } from '../../../../instances/divided-world/index.ts';
import { whoops } from '../../../../instances/divided-world/cards/whoops.ts';
import { feelinFab } from '../../../../instances/divided-world/cards/feelin-fab.ts';

const out = fileURLToPath(new URL('./prompts', import.meta.url));
mkdirSync(out, { recursive: true });

const s = instance.settings;
const qc = instance.system.roster.find((p) => p.key === 'quality-control')!;
const he = PRONOUN_PRESETS.he;
const limits = { threadPosts: s.pool.chatterThreadPosts, excerptChars: s.digestExcerptChars, titleMaxLength: s.titleMaxLength };
const board = { name: 'Arts & Crafts', premise: instance.boards.find((b) => b.slug === 'arts-crafts')!.description };
const beat = [{ id: 'video-games', name: 'Video Games' }, { id: 'arts-crafts', name: 'Arts & Crafts' }];
const career = { led: [], offices: [{ office: 'mod', since: '2027-01-01T00:00:00.000Z', until: null, cause: 'seed' }] };
// The Boss's real order to QC-1000 from the second rehearsal (staff-lines.json, orderNoAllowance).
const order = 'As discussed: no allowance. The knitted Goomba and the waffle-brick tileset are art. Approve one thing this week, please. (For me.)';
const mod = {
  persona: qc, office: 'mod' as const, offices: instance.system.offices, pronouns: qc.pronouns ?? he, order, career, memory: null, notes: [],
  rules: [], allowance: 0, beat, ruleDaysMost: s.modBots.ruleDaysMost, expiryLeastHours: s.moveExpiryLeastHours, names: () => 'a character',
};

// The thread as readers see it now: autocorrect strips read as their replacements, smoke and ink do not change words.
const she = PRONOUN_PRESETS.she;
const P = (name: string, body: string) => ({ name, pronouns: name === 'Serious Deer' ? she : he, body: body.length > s.digestExcerptChars ? body.slice(0, s.digestExcerptChars - 1) + '…' : body, cut: body.length > s.digestExcerptChars });
const posts = [
  P('Snuckles', "Hi divided world, it's ya boy Snuckles here with my first ever sprite sheet. He's an original character I invented after I saw him in a Mario game. [image] Let me know what you think!"),
  P('Shy Guy Fieri', 'Good job! Looks cool'),
  P('A Goomba', 'Not too shabby'),
  P('Irock', "I'll use it in my game!"),
  P('D-Guy', 'The walk looks like it was hard to make 💪'),
  P('Hotel Bro', 'OF COURSE YOUR SPRITES LOOK LIKE THIS WITH THOSE STEAMBOAT WILLIE ASS FINGERS'),
  P('Snuckles', "I don't understand. Is that good or bad? Steamboat Willie is a classic."),
  P('Hotel Bro', "Who was that react from?! Come fight me like a man and I'll show ya where to put that thumbs up."), // #8, before its tape
  P('Chadluminum', 'Big talk from a guy whose girlfriend went to 7 hotels in one night.'),
  P('Hotel Bro', "How 'bout you stay outta this one, blockhead?"),
  P('Snuckles', "I'm going to keep working on my sheet. I think I'm really close to a breakthrough."),
  P('Serious Deer', 'You would do well to address the pillow shading.'),
  P('D-Guy', 'This sheet makes me wanna wiggle in all sorts of ways 👀'), // #13
  P('Chadluminum', 'Some go their whole lives wondering. Only a few among us truly achieve the greatness of glazing a Sprite Sheet'), // #14, as taped
  P('Snuckles', "> You would do well to address the pillow shading.\nWhat's shading?"),
  P('A Goomba', 'Someone really ought to shut this Hotel guy up.....'),
  P('Hotel Bro', "Oh yeah? What are you gonna do, throw somethin' at me? I'd like to see ya try!"), // #17
  P('Snuckles', 'I think I fixed the shading. [image]'),
  P('Serious Deer', 'After analyzing the pixels in this sprite sheet I have come to the unfortunate conclusion that it was created with the assistance of generative AI.'),
  P('Chadluminum', 'To be trapped in this place, with you people, is an indescribable hell.'), // #20
];
const title = 'Look At My Wiggler Sprites';
/** The thread as pool_thread hands it: the newest `threadPosts` up to and including post #n (1-based). */
const upTo = (n: number) => ({ title, posts: posts.slice(Math.max(0, n - s.pool.chatterThreadPosts), n) });
const at = (n: number) => posts[n - 1]!;
const premise = [{ rule: 'the board\'s premise', band: 'minor' }];

const calls: Record<string, unknown>[] = [];
const add = (id: string, duty: string, frame: { system: string; message: string; schema: Record<string, unknown> }) =>
  calls.push({ id, duty, tier: 'light', ...frame });

// A. Chadluminum reports #8. The reason is the player's own words, written for the scene.
add('a-report-8', 'reportJudge', reportPrompt({
  ...mod, board, thread: upTo(9), post: at(8), limits,
  reporter: { name: 'Chadluminum', pronouns: he },
  reason: "He's threatening to fight people in a sprite thread. A sprite thread!",
}));

// B. The patrol's visit to #13 (D-Guy), filed when it ends; Take the Fall moves its points, which the line is not told.
add('b-filing-13', 'filing', filingPrompt({ ...mod, board, thread: upTo(13), post: at(13), charges: premise.map((c) => ({ ...c, cause: 'patrol' })), limits }));

// C. The patrol's visit to #14 (Chadluminum, as taped), filed after his quiz answer failed.
add('c-filing-14', 'filing', filingPrompt({ ...mod, board, thread: upTo(14), post: at(14), charges: premise.map((c) => ({ ...c, cause: 'patrol' })), limits }));

// D. The tail visit on #20: Chadluminum's next post after a failed interception.
add('d-filing-20', 'filing', filingPrompt({ ...mod, board, thread: upTo(20), post: at(20), charges: [{ rule: 'Obstruction', band: 'minor', cause: 'tail' }], limits })); // as draw_visits writes it (0105_visits.sql)

// E. A Goomba reports #17 from his spun thread, after So Very Happy locked him out.
add('e-report-17', 'reportJudge', reportPrompt({
  ...mod, board, thread: upTo(17), post: at(17), limits,
  reporter: { name: 'A Goomba', pronouns: he },
  reason: 'He literally asked me to throw something and then I got locked out for it. This is entrapment. Please do something.',
}));

// G. QC-1000's pool post in the thread, replying to #13, with two commons on offer. One take; it may play neither.
const offer = (c: { key: string; name: string; staffOptions?: { prompt: string; schema: Record<string, unknown> } }) => ({ key: c.key, name: c.name, play: 'cast' as const, ...(c.staffOptions ? { options: c.staffOptions } : {}) });
const offered = [offer(whoops), offer(feelinFab)];
const chat = chatterPrompt({
  premise: POOL_PREMISE, persona: qc, office: 'mod', offices: instance.system.offices, pronouns: qc.pronouns ?? he, career, memory: null, notes: [],
  thread: upTo(13), quoting: at(13), trigger: 'hotOnBeat', offeredCards: offered, startThread: false,
  limits: { ...limits, postMaxLength: s.postMaxLength }, names: () => 'a character',
});
calls.push({ id: 'g-pool-13', duty: 'chatter', tier: 'light', system: chat.system, message: chat.message, schema: chatterSchema({ askedTitle: false, offered }) });

for (const c of calls) writeFileSync(`${out}/${c.id}.json`, JSON.stringify(c, null, 2));
console.log(calls.map((c) => `${c.id}: system ${String(c.system).length} chars, message ${String(c.message).length} chars`).join('\n'));
