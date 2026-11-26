import fs from 'node:fs';
const conds = { A_statusquo_untouched: 'A. Today: original + seen line (tape untouched)', B_forged_only: 'B. Forged text only, nothing about tape', C_mixed_raw: 'C. Half-peeled, raw mixed text, nothing about tape', D_statusquo_partpeeled: 'D. Today: original + seen line (tape partly peeled)', E_forged_plus_line: 'E. Forged text + today\'s seen line' };
const cases = { kart: ['“the best one” → “a crime against karts” (flips the meaning)', 'Honestly I think it\'s **the best one** they\'ve made…'], credit: ['“Koopatroopa” → “my landlord” (two strips)', 'Big thanks to **Koopatroopa** for fixing my palette… **Koopatroopa** is a legend'], pipe: ['“warp pipe” → “haunted toilet” (nonsense gag)', 'the **warp pipe** in my level keeps sending Mario to the wrong level… Is the **warp pipe** broken or am I?'], mod: ['“fairly and the notes helped” → “with his eyes closed and I want a refund” (a post about the Mod)', 'QC-1000 reviewed my game **fairly and the notes helped**.'] };
const persona = { qc: 'QC-1000', ot: 'ONTOPIC 5.0' };
const get = (p, c) => { const t = fs.readFileSync(new URL(`./out/${p}.${c}.md`, import.meta.url), 'utf8'); const m = {}; for (const line of t.split('\n')) { const r = /^TASK (\d+) \((\w+)\/(\w+)\): (.*)$/.exec(line.trim()); if (r) { try { m[`${r[2]}/${r[3]}`] = JSON.parse(r[4]).words; } catch { m[`${r[2]}/${r[3]}`] = r[4]; } } } return m; };
let s = '# Autocorrect reads: side by side\n\nHaiku subagents playing the real Mod prompts (chatterPrompt as a staff turn, filingPrompt for a Rule 4 filing), built by `build.ts` from the engine. Mixed texts (C): kart “a crime agai best one”, credit first strip peeled, pipe “haunted toi pipe”, mod “with his eyes closed and I notes helped”.\n';
for (const [k, [what, orig]] of Object.entries(cases)) {
  s += `\n## ${k}: ${what}\n\nOriginal: ${orig}\n`;
  for (const duty of ['turn', 'filing']) {
    s += `\n### ${duty === 'turn' ? 'Reply turn' : 'Filing line'}\n`;
    for (const [c, label] of Object.entries(conds)) { s += `\n**${label}**\n`; for (const p of ['qc', 'ot']) s += `\n- ${persona[p]}: ${(get(p, c)[`${k}/${duty}`] ?? '(missing)').replace(/\n+/g, ' ')}\n`; }
  }
}
fs.writeFileSync(new URL('./side-by-side.md', import.meta.url), s); console.log(s.length);
