/**
 * The Staff's own words, for the video's Staff shots (docs/plans/2026-11-14-hype-video-storyboard.md, section 6): lines the staff
 * wrote in the second season rehearsal, taken from its logs word for word and written where the stage can read them.
 *
 *   node tools/hype/staff-lines.mjs
 *
 * Each pick names a log (an arc of docs/research/2026-11-13-season-rehearsal-run-2/logs/), a day of it, who spoke, and words the line
 * holds, so a pick that no longer matches anything fails here and not on camera. A `chatter` pick is a whole post; a `move` pick is the
 * reason the Boss gave for a move. Nothing is trimmed or joined. One thing is changed, by the owner's word (2026-11-14): the rehearsal's
 * posters, whom the staff name, are given the names of the video's cast (`NAMES`), so the staff speak of the people on screen. The line as
 * the model wrote it is kept beside it (`said`).
 *
 * Writes instances/divided-world/ui/hype/staff-lines.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const LOGS = 'docs/research/2026-11-13-season-rehearsal-run-2/logs';
const OUT = 'instances/divided-world/ui/hype/staff-lines.json';

const PICKS = {
  memo: { arc: 'arc-1-honeymoon', day: 2, from: 'chatter', staff: 'fangame', holds: 'writing per my own initiative, as nobody asked' },
  declined: { arc: 'arc-4-meltdown', day: 1, from: 'chatter', staff: 'quality-control', holds: 'DECLINED: a version of this post already exists' },
  stars: { arc: 'arc-5-handover', day: 2, from: 'chatter', staff: 'ontopic', holds: 'it should simply be given a title' },
  farewell: { arc: 'arc-5-handover', day: 6, from: 'chatter', staff: 'fangame', holds: 'this is my last post as Boss' },
  arrival: { arc: 'arc-5-handover', day: 6, from: 'chatter', staff: 'quality-control', holds: 'Is this a demo or the full game?' },
  created: { arc: 'arc-5-handover', day: 2, from: 'moves', staff: 'fangame', kind: 'createBoard', holds: 'My greatest Improvement Initiative' },
  successor: { arc: 'arc-5-handover', day: 2, from: 'moves', staff: 'fangame', kind: 'nameSuccessor', holds: 'He gets it' },
  merged: { arc: 'arc-5-handover', day: 5, from: 'moves', staff: 'fangame', kind: 'mergeBoard', holds: 'Nobody posted on my board anyway' },
};

/* The rehearsal's posters, and who of the video's cast stands in for each: the Front Door's five, so some stand in for more than one. */
const NAMES = {
  Ironpudding: 'Snuckles', Cobaltpretzel: 'Chadluminum', 'Barnacle Jim': 'Serious Deer', Waffleknight: 'D-Guy', 'Plumber Wick': 'Human Josh',
  'Sodapop Rex': 'Human Josh', Quillfern: 'Chadluminum', Gravelbyte: 'D-Guy', Zephyrgoat: 'Snuckles', Mothwire: 'Serious Deer',
  'Dingleberry Ox': 'D-Guy', Crumpetmoon: 'Serious Deer',
};
const recast = (text) => Object.entries(NAMES).reduce((t, [from, to]) => t.replaceAll(from, to), text);

const logs = new Map();
const log = (arc) => {
  if (!logs.has(arc)) logs.set(arc, JSON.parse(gunzipSync(readFileSync(`${LOGS}/${arc}.json.gz`)).toString('utf8')));
  return logs.get(arc);
};

const lines = {};
for (const [name, pick] of Object.entries(PICKS)) {
  const day = log(pick.arc).days.find((d) => d.day === pick.day);
  if (!day) throw new Error(`${name}: ${pick.arc} has no day ${pick.day}`);
  const found = day[pick.from].filter((e) => String(e.staff).startsWith(pick.staff) && (pick.kind === undefined || e.kind === pick.kind) && String(pick.from === 'moves' ? e.why : e.body).includes(pick.holds));
  if (found.length === 0) throw new Error(`${name}: nothing ${pick.staff} ${pick.from === 'moves' ? 'gave as a reason' : 'wrote'} on day ${pick.day} of ${pick.arc} holds "${pick.holds}"`);
  const e = found[0];
  const said = pick.from === 'moves' ? e.why : e.body;
  lines[name] = { text: recast(said), said, by: e.character ?? e.staff, arc: pick.arc, day: pick.day, at: e.at ?? e.landedAt ?? e.goLiveAt ?? null, ...(pick.kind ? { move: pick.kind } : {}) };
  console.log(`${name}: ${lines[name].by}, ${pick.arc} day ${pick.day}, ${lines[name].text.length} characters`);
}
writeFileSync(OUT, `${JSON.stringify(lines, null, 2)}\n`);
console.log(`wrote ${OUT}`);
