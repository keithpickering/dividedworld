/**
 * The Staff's own words, for the video's Staff shots (docs/plans/2026-11-14-hype-video-storyboard.md, section 6;
 * docs/plans/2026-11-21-commentary-video-revision-design.md, section 5): lines the staff wrote in the second season rehearsal, taken from its
 * logs word for word and written where the stage can read them.
 *
 *   node tools/hype/staff-lines.mjs
 *
 * Each pick names a log (an arc of docs/research/2026-11-13-season-rehearsal-run-2/logs/), a day of it, where in the day the line lives
 * (`from`), who spoke, and words the line holds, so a pick that no longer matches anything fails here and not on camera. Where a line lives:
 *
 *   chatter   a staff post                         days[].chatter[].body
 *   order     the Boss's memo to a Mod             days[].orders[].line
 *   moves     the reason the Boss gave for a move   days[].moves[].why   (with `kind`; a `failure` is kept where the move failed)
 *   visit     a Mod's opening line on a visit       days[].visits[].line
 *   filing    a Mod's filing, and the post it was aimed at   days[].infractions[].call.answer.words, the post in `call.prompt`
 *   farewell  the Boss's farewell at a meeting      days[].meetings[].parts[part=self].answer.farewell
 *   handoff   the Boss's handoff note               days[].meetings[].parts[part=self].answer.handoff
 *
 * Nothing is trimmed or joined. One thing is changed, by the owner's word (2026-11-14): the rehearsal's posters, whom the staff name, are
 * given the names of the video's cast (`NAMES`), so the staff speak of the people on screen. The line as the model wrote it is kept
 * beside it (`said`), and a test (Stage.test.tsx) reads these logs itself and finds every `said` in one, character for character. Board
 * names (Help, Movies & TV, the Palace, World -1) stay as the Mods said them.
 *
 * Writes instances/divided-world/ui/hype/staff-lines.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const LOGS = 'docs/research/2026-11-13-season-rehearsal-run-2/logs';
const OUT = 'instances/divided-world/ui/hype/staff-lines.json';

export const PICKS = {
  /* The Boss's memos: a post of his in a thread, and the memos he gave his Mods. */
  memo: { arc: 'arc-1-honeymoon', day: 2, from: 'chatter', staff: 'fangame', holds: 'writing per my own initiative, as nobody asked' },
  orderNoAllowance: { arc: 'arc-1-honeymoon', day: 2, from: 'order', staff: 'quality-control', holds: 'The knitted Goomba and the waffle-brick tileset are art' },
  orderHoneymoon: { arc: 'arc-1-honeymoon', day: 1, from: 'order', staff: 'ontopic', holds: 'Please report on the Palace' },
  orderQuote: { arc: 'arc-1-honeymoon', day: 2, from: 'order', staff: 'ontopic', holds: 'Quote one real Palace reply' },
  /* A Mod's opening line on a visit: two for each. */
  openerQcHelp: { arc: 'arc-1-honeymoon', day: 3, from: 'visit', staff: 'quality-control', holds: 'QC-1000 has arrived with a clipboard and no explanation, and suspects the premise of Help.' },
  openerQcArts: { arc: 'arc-1-honeymoon', day: 2, from: 'visit', staff: 'quality-control', holds: 'Page one reads the premise of Arts & Crafts.' },
  openerOtBreathing: { arc: 'arc-1-honeymoon', day: 2, from: 'visit', staff: 'ontopic', holds: 'Nobody panic. ONTOPIC 5.0 is only standing next to this post and breathing' },
  openerOtLooking: { arc: 'arc-1-honeymoon', day: 1, from: 'visit', staff: 'ontopic', holds: 'ONTOPIC 5.0 takes a long time over these.' },
  /* A Mod's filing, with the post it was aimed at: three for each. */
  filingQcHelp: { arc: 'arc-2-split', day: 3, from: 'filing', staff: 'quality-control', holds: 'the respect was noted. The no was not helpful.' },
  filingQcGames: { arc: 'arc-1-honeymoon', day: 5, from: 'filing', staff: 'quality-control', holds: "'consider me intrigued' names no game" },
  filingQcGotcha: { arc: 'arc-3-reign', day: 4, from: 'filing', staff: 'quality-control', holds: 'Gotcha is not a sprite. Count remains 997.' },
  filingOtThematic: { arc: 'arc-1-honeymoon', day: 1, from: 'filing', staff: 'ontopic', holds: "Thematic integrity, I'm afraid, was not consulted." },
  filingOtPatience: { arc: 'arc-5-handover', day: 5, from: 'filing', staff: 'ontopic', holds: 'Filed under premise, with patience.' },
  filingOtPalace: { arc: 'arc-4-meltdown', day: 3, from: 'filing', staff: 'ontopic', holds: 'The Palace does not accept almost.' },
  /* The Boss's moves, each with the reason he gave. */
  created: { arc: 'arc-4-meltdown', day: 2, from: 'moves', staff: 'fangame', kind: 'createBoard', holds: 'The board is arguing whether a fangame is a video game.' },
  moved: { arc: 'arc-5-handover', day: 3, from: 'moves', staff: 'fangame', kind: 'moveThread', holds: 'a monster movie is a boss fight with no controller' },
  merged: { arc: 'arc-4-meltdown', day: 5, from: 'moves', staff: 'fangame', kind: 'mergeBoard', holds: 'Per the consolidation plan, the Palace joins World -1' },
  /* The merge that landed in the last arc, and the one after it that could not (its `failure` is kept). */
  mergedLast: { arc: 'arc-5-handover', day: 5, from: 'moves', staff: 'fangame', kind: 'mergeBoard', holds: 'Nobody posted on my board anyway' },
  mergeFailed: { arc: 'arc-5-handover', day: 5, from: 'moves', staff: 'fangame', kind: 'mergeBoard', holds: 'It makes sense. It does.' },
  /* A Mod's reviews and rulings posted in a thread. */
  declined: { arc: 'arc-4-meltdown', day: 1, from: 'chatter', staff: 'quality-control', holds: 'DECLINED: a version of this post already exists' },
  stars: { arc: 'arc-5-handover', day: 2, from: 'chatter', staff: 'ontopic', holds: 'it should simply be given a title' },
  fiveStars: { arc: 'arc-1-honeymoon', day: 4, from: 'chatter', staff: 'ontopic', holds: '★★★★★' },
  /* The handover. */
  successor: { arc: 'arc-5-handover', day: 2, from: 'moves', staff: 'fangame', kind: 'nameSuccessor', holds: 'He gets it' },
  farewell: { arc: 'arc-5-handover', day: 1, from: 'farewell', staff: 'fangame', holds: 'Robots in the Draw event do not cry' },
  handoff: { arc: 'arc-5-handover', day: 1, from: 'handoff', staff: 'fangame', holds: 'two empty boards are yours' },
  posted: { arc: 'arc-5-handover', day: 6, from: 'chatter', staff: 'fangame', holds: 'this is my last post as Boss' },
  arrival: { arc: 'arc-5-handover', day: 6, from: 'chatter', staff: 'quality-control', holds: 'QC-1000 has taken the seat.' },
  followup: { arc: 'arc-5-handover', day: 6, from: 'chatter', staff: 'quality-control', holds: 'Is this a demo or the full game?' },
};

/* The rehearsal's posters, and who of the video's cast stands in for each: the Front Door's five, so some stand in for more than one. */
export const NAMES = {
  Ironpudding: 'Snuckles', Cobaltpretzel: 'Chadluminum', 'Barnacle Jim': 'Serious Deer', Waffleknight: 'D-Guy', 'Plumber Wick': 'Human Josh',
  'Sodapop Rex': 'Human Josh', Quillfern: 'Chadluminum', Gravelbyte: 'D-Guy', Zephyrgoat: 'Snuckles', Mothwire: 'Serious Deer',
  'Dingleberry Ox': 'D-Guy', Crumpetmoon: 'Serious Deer', Marmaladedrift: 'Snuckles', Bolthole: 'Human Josh', Hexlantern: 'Chadluminum',
  Stratocumulo: 'Serious Deer', 'Lanternfish 97': 'Chadluminum', Tanukibrine: 'Human Josh',
};
const recast = (text) => Object.entries(NAMES).reduce((t, [from, to]) => t.replaceAll(from, to), text);

const logs = new Map();
const log = (arc) => {
  if (!logs.has(arc)) logs.set(arc, JSON.parse(gunzipSync(readFileSync(`${LOGS}/${arc}.json.gz`)).toString('utf8')));
  return logs.get(arc);
};

/** The post a filing was aimed at, from its call's prompt: who wrote it, its words, its thread and its board. */
export function aimedAt(prompt) {
  const board = /The board: (.+?)\. /u.exec(prompt)?.[1];
  const thread = /Thread: "(.*)"\n/u.exec(prompt)?.[1];
  const post = /The post you inspected, by (.+?) \((?:[^)]*)\): "(.*)"\n/u.exec(prompt);
  if (!board || !thread || !post) throw new Error('a filing\'s prompt no longer names its board, thread and post');
  return { board, thread, by: NAMES[post[1]] ?? post[1], saidBy: post[1], text: recast(post[2]), said: post[2] };
}

/** The line a pick finds, as { said, entry, extra } in its day of its log. */
export function find(pick) {
  const day = log(pick.arc).days.find((d) => d.day === pick.day);
  if (!day) throw new Error(`${pick.arc} has no day ${pick.day}`);
  const staffOf = (s) => String(s ?? '').startsWith(pick.staff);
  const all = [];
  const add = (said, entry, extra = {}) => { if (typeof said === 'string' && said.includes(pick.holds)) all.push({ said, entry, extra }); };
  if (pick.from === 'chatter') for (const e of day.chatter.filter((e) => staffOf(e.staff))) add(e.body, e, { at: e.at });
  if (pick.from === 'order') for (const e of day.orders.filter((e) => staffOf(e.staff))) add(e.line, e, { at: e.at ?? null });
  if (pick.from === 'moves') for (const e of day.moves.filter((e) => staffOf(e.staff) && e.kind === pick.kind)) add(e.why, e, { at: e.landedAt ?? e.goLiveAt, ...(e.failure ? { failure: e.failure } : {}) });
  if (pick.from === 'visit') for (const e of day.visits.filter((e) => staffOf(e.staff))) add(e.line, e, { at: e.at });
  if (pick.from === 'filing') for (const e of day.infractions.filter((e) => staffOf(e.payload.staff))) add(e.call?.answer?.words, e, { at: e.at, band: e.payload.band, points: e.payload.points, post: e.call?.prompt ? aimedAt(e.call.prompt) : null });
  if (pick.from === 'farewell' || pick.from === 'handoff') {
    for (const m of day.meetings) for (const p of m.parts.filter((p) => p.part === 'self')) add(p.answer?.[pick.from], p, { at: m.finishedAt ?? m.startedAt, by: 'fangame' });
  }
  if (all.length === 0) throw new Error(`nothing ${pick.staff} wrote as ${pick.from} on day ${pick.day} of ${pick.arc} holds "${pick.holds}"`);
  return all[0];
}

/** Every pick, found: { name: line }. */
export function lines() {
  const out = {};
  for (const [name, pick] of Object.entries(PICKS)) {
    const { said, entry, extra } = find(pick);
    const by = extra.by ?? entry.character ?? entry.staff ?? entry.payload?.staff;
    const { by: _by, ...rest } = extra;
    out[name] = { text: recast(said), said, by, arc: pick.arc, day: pick.day, from: pick.from, ...rest, ...(pick.kind ? { move: pick.kind } : {}) };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const made = lines();
  for (const [name, l] of Object.entries(made)) console.log(`${name}: ${l.by}, ${l.arc} day ${l.day}, ${l.text.length} characters`);
  writeFileSync(OUT, `${JSON.stringify(made, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
}
