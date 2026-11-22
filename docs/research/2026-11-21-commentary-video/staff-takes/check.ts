// Runs each answer (answers/<id>.json) through the engine's own repair, as the staff and chatter functions do, and prints what
// would have been kept, with every trim and drop and the predicate that failed.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { repairFiling, repairReport } from '../../../../engine/system/judgment.ts';
import { repairChatter } from '../../../../engine/system/chatter.ts';
import { instance } from '../../../../instances/divided-world/index.ts';
import { whoops } from '../../../../instances/divided-world/cards/whoops.ts';

const dir = fileURLToPath(new URL('.', import.meta.url));
const s = instance.settings;
const ctx = { allowance: 0, beat: ['video-games', 'arts-crafts'], ruleDaysMost: s.modBots.ruleDaysMost, expiryLeastHours: s.moveExpiryLeastHours };
const offered = [{ key: 'whoops', name: 'Whoops!', play: 'cast' as const }, { key: 'feelin-fab', name: "Feelin' Fab", play: 'cast' as const }];

for (const id of ['a-report-8', 'b-filing-13', 'c-filing-14', 'd-filing-20', 'e-report-17', 'g-pool-13']) {
  const f = `${dir}answers/${id}.json`;
  if (!existsSync(f)) { console.log(`${id}: no answer yet`); continue; }
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const r = id.includes('report') ? repairReport(raw, { ...ctx, rules: [] })
    : id.includes('filing') ? repairFiling(raw, ctx)
    : repairChatter(raw, { postMaxLength: s.postMaxLength, titleMaxLength: s.titleMaxLength, askedTitle: false, offered });
  console.log(`== ${id}\n${JSON.stringify(r, null, 1)}`);
  const card = (r as { answer?: { card?: { key: string; config?: unknown } } }).answer?.card;
  if (card?.key === 'whoops') console.log('whoops config:', JSON.stringify(whoops.validateConfig(card.config ?? {}, undefined as never)));
}
