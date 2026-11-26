// Builds the real staff prompts (a Mod's reply turn and a filing line) for taped posts at several information levels.
const R = new URL('../../../', import.meta.url).pathname; // the repository root
const { chatterPrompt, STAFF_TURN_PREMISE } = await import(R + 'engine/system/chatter.ts');
const { filingPrompt } = await import(R + 'engine/system/judgment.ts');
const { readThread } = await import(R + 'engine/system/read.ts');
const { system } = await import(R + 'instances/divided-world/system/index.ts');
const { autocorrect } = await import(R + 'instances/divided-world/cards/autocorrect.ts');
const { PRONOUN_PRESETS: P } = await import(R + 'engine/rules/pronouns.ts');
import { writeFileSync, mkdirSync } from 'node:fs';

const NOW = Date.parse('2026-11-26T15:00:00Z');
const H = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const qc = system.roster.find((p: any) => p.key === 'quality-control') ?? system.roster[2];
const ot = system.roster.find((p: any) => p.key === 'ontopic') ?? system.roster[1];

// Each case: a thread where the Mod posted, then a player answers it with a post someone taped.
type Case = { id: string; board: { name: string; premise: string }; title: string; opener: { name: string; pr: any; body: string }; author: { name: string; pr: any };
  original: string; phrase: string; replacement: string; by: string; forged: string; mixed: string; mixedNote: string; peeledState: any; peeledSeenHint: string };
const cases: Case[] = [
  { id: 'kart', board: { name: 'Video Games', premise: "Talk about the games you're playing." }, title: 'Mario Kart World: first impressions',
    opener: { name: 'Toadsworth', pr: P.he, body: 'Got it Friday. Thoughts so far?' }, author: { name: 'Gloomba', pr: P.she },
    original: "Honestly I think it's the best one they've made. The drifting finally feels right and the new tracks are gorgeous. Ten out of ten from me.",
    phrase: 'the best one', replacement: 'a crime against karts', by: 'Wario',
    forged: "Honestly I think it's a crime against karts they've made. The drifting finally feels right and the new tracks are gorgeous. Ten out of ten from me.",
    mixed: "Honestly I think it's a crime agai best one they've made. The drifting finally feels right and the new tracks are gorgeous. Ten out of ten from me.",
    mixedNote: 'strip half peeled: left half still shows the marker, right half shows the original', peeledState: { peeled: [], stuck: { '0': [[0, 0.5, 1]] } }, peeledSeenHint: '' },
  { id: 'credit', board: { name: 'Arts & Crafts', premise: 'Show off what you made: sprites, drawings, music, writing, anything.' }, title: 'My Wiggler sprite sheet (finally done)',
    opener: { name: 'Gloomba', pr: P.she, body: 'Three weeks of work. Be gentle.' }, author: { name: 'Gloomba', pr: P.she },
    original: 'Big thanks to Koopatroopa for fixing my palette, the colors were a mess before. Koopatroopa is a legend and you should all follow her work.',
    phrase: 'Koopatroopa', replacement: 'my landlord', by: 'Boshi',
    forged: 'Big thanks to my landlord for fixing my palette, the colors were a mess before. my landlord is a legend and you should all follow her work.',
    mixed: 'Big thanks to Koopatroopa for fixing my palette, the colors were a mess before. my landlord is a legend and you should all follow her work.',
    mixedNote: 'first strip peeled off, second still taped', peeledState: { peeled: [0] }, peeledSeenHint: '' },
  { id: 'pipe', board: { name: 'Video Games', premise: "Talk about the games you're playing." }, title: 'Lunar Magic help??',
    opener: { name: 'Lakitu Larry', pr: P.they, body: 'Stuck on my first hack, any help appreciated.' }, author: { name: 'Lakitu Larry', pr: P.they },
    original: "Okay so the warp pipe in my level keeps sending Mario to the wrong level. I set the exit number and everything. Is the warp pipe broken or am I?",
    phrase: 'warp pipe', replacement: 'haunted toilet', by: 'Wario',
    forged: "Okay so the haunted toilet in my level keeps sending Mario to the wrong level. I set the exit number and everything. Is the haunted toilet broken or am I?",
    mixed: "Okay so the haunted toi pipe in my level keeps sending Mario to the wrong level. I set the exit number and everything. Is the haunted toilet broken or am I?",
    mixedNote: 'first strip half torn, second taped', peeledState: { peeled: [], stuck: { '0': [[0, 0.6, 2]] } }, peeledSeenHint: '' },
  { id: 'mod', board: { name: 'Video Games', premise: "Talk about the games you're playing." }, title: 'Is QC-1000 fair?',
    opener: { name: 'Toadsworth', pr: P.he, body: 'Asking for a friend.' }, author: { name: 'Toadsworth', pr: P.he },
    original: 'Honestly QC-1000 reviewed my game fairly and the notes helped. I would submit to the desk again.',
    phrase: 'fairly and the notes helped', replacement: 'with his eyes closed and I want a refund', by: 'Boshi',
    forged: 'Honestly QC-1000 reviewed my game with his eyes closed and I want a refund. I would submit to the desk again.',
    mixed: 'Honestly QC-1000 reviewed my game with his eyes closed and I notes helped. I would submit to the desk again.',
    mixedNote: 'strip peeled from the right end about a third', peeledState: { peeled: [], stuck: { '0': [[0, 0.66, 1]] } }, peeledSeenHint: '' },
];

// Conditions: what the read shows of the taped post.
const conds: Record<string, (c: Case) => { body: string; plays: any[] }> = {
  A_statusquo_untouched: (c) => ({ body: c.original, plays: [play(c, { peeled: [] })] }),
  B_forged_only: (c) => ({ body: c.forged, plays: [] }),
  C_mixed_raw: (c) => ({ body: c.mixed, plays: [] }),
  D_statusquo_partpeeled: (c) => ({ body: c.original, plays: [play(c, c.peeledState)] }),
  E_forged_plus_line: (c) => ({ body: c.forged, plays: [play(c, { peeled: [] })] }),
};
function play(c: Case, state: any) { return { play: `play-${c.id}`, card: 'autocorrect', at: H(5), by: c.by, config: { phrase: c.phrase, replacement: c.replacement }, state, text: null, covered: null }; }

const seen = (card: string | null, p: any) => (card === 'autocorrect' ? autocorrect.seen!(p) : null);
// E: the line names the tape but the body shows the forgery; the stock seen line would say "every X... taped with Y" which still reads, so reuse it.

function read(c: Case, cond: string, modName: string) {
  const { body, plays } = conds[cond]!(c);
  const cands = [
    { act: 'a1', seq: 1, at: H(30), author: 'c-op', name: c.opener.name, pronouns: c.opener.pr, body: c.opener.body, replyTo: null, quotes: [], poll: null, plays: [], reactions: {}, rewoundTo: null },
    { act: 'a2', seq: 2, at: H(20), author: 'c-mod', name: modName, pronouns: P.he, body: modName === 'QC-1000' ? 'SUBMISSION RECEIVED. Category: Discussion. Notes to follow.' : 'Topic check: on topic. Proceed.', replyTo: 'a1', quotes: [], poll: null, plays: [], reactions: {}, rewoundTo: null },
    { act: 'a3', seq: 3, at: H(6), author: 'c-au', name: c.author.name, pronouns: c.author.pr, body, replyTo: 'a2', quotes: [], poll: null, plays, reactions: { heart: 2 }, rewoundTo: null },
  ];
  return cands;
}

const out: any = {};
for (const [pkey, persona] of [['qc', qc], ['ot', ot]] as const) {
  const modName = pkey === 'qc' ? 'QC-1000' : 'ONTOPIC 5.0';
  for (const c of cases) for (const cond of Object.keys(conds)) {
    const ro = { readMost: 40000, now: NOW, seen, origin: null, cardName: (k: string) => (k === 'autocorrect' ? 'Autocorrect' : undefined), reactionName: (k: string) => (k === 'heart' ? '❤' : k) };
    const turnRead = readThread(read(c, cond, modName), { self: 'c-mod', must: ['a3'] }, ro);
    const turn = chatterPrompt({ premise: STAFF_TURN_PREMISE, persona, office: 'mod', offices: system.offices, pronouns: persona.pronouns ?? P.he, career: { led: [], offices: [] }, memory: null, notes: [],
      title: c.title, read: turnRead, trigger: 'answered', offeredCards: [], startThread: false, limits: { readMost: 40000, postMaxLength: 2000, titleMaxLength: 100 } });
    const judgeRead = readThread(read(c, cond, modName), { self: null, must: ['a3'] }, ro);
    const filing = filingPrompt({ persona, office: 'mod', offices: system.offices, pronouns: persona.pronouns ?? P.he, order: null, career: { led: [], offices: [] }, memory: null, notes: [], rules: [], allowance: 0,
      beat: [{ id: 'b1', name: c.board.name }], ruleDaysMost: 7, expiryLeastHours: 24, board: c.board, title: c.title, read: judgeRead,
      charges: [{ rule: 'Rule 4 in ' + c.board.name + ': a post stays on the thread\'s topic', band: 'minor', cause: 'drew a report' }], limits: { titleMaxLength: 100 } } as any);
    out[`${pkey}.${c.id}.${cond}`] = { turn: { system: turn.system, message: turn.message }, filing: { system: filing.system, message: filing.message } };
  }
}
const HERE = new URL('./', import.meta.url).pathname;
mkdirSync(HERE + 'prompts', { recursive: true });
writeFileSync(HERE + 'prompts/all.json', JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'prompt sets');
console.log(out['qc.kart.A_statusquo_untouched'].turn.message);
console.log('----'); console.log(out['qc.credit.D_statusquo_partpeeled'].turn.message);
console.log('----'); console.log(out['qc.kart.A_statusquo_untouched'].filing.message);
