/**
 * Tests for the guard in tools/check-guide.mjs.
 *
 *   node tools/test-guide.mjs
 *
 * The guard holds an instance's Strategy Guide to the instance it describes: a hint for each class and no other, only markers the engine
 * fills, only settings the page can say, and no number typed into the prose. Each of those is a guide that reads fine to its author and
 * is wrong to a player (a class card with no hint, a list that draws nothing, a dash where a number was, "6.00 orbs" after a retune
 * to 8.00). So each is planted here and must fire, the real tree is poisoned the same ways, and the real tree runs clean last, so a guard
 * gone quiet over nothing fails here.
 */
import { guideFaults, instanceNames, readInstance, screenSettingsOf } from './check-guide.mjs';

let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

const FILE = 'instances/x/guide/strategy-guide.md';
const HINTS_FILE = 'instances/x/guide/hints.ts';
const CLASSES = ['face', 'heel'];
const HINTS = { face: 'Get behind the posts you like.', heel: 'Being hated is a living.' };
const SETTINGS = screenSettingsOf({
  walletCap: 600, reactionCap: 3, charactersPerPlayer: 6, registrationMode: 'invite',
  turnCooldown: { unit: 'day', count: 30 }, economy: { 'whoops.price': 100, 'lurker.crowd': 3 },
});
const GOOD = '## Aura\n\nA wallet holds {{setting:walletCap}} orbs.\n\n<!-- kayfabb:classes -->\n';
const faultsOf = (markdown, o = {}) => guideFaults({ file: FILE, markdown, hints: HINTS, classKeys: CLASSES, settings: SETTINGS, ...o });
const fires = (markdown, pattern, o = {}) => {
  const r = faultsOf(markdown, o);
  return r.length >= 1 && r.every((f) => pattern.test(f.why));
};

/* ---- the hints: exactly the classes ---- */
{
  const missing = faultsOf(GOOD, { hints: { face: HINTS.face } });
  check('a hint map with a class missing fires, naming the class and the hint file', missing.length === 1 && /no hint for the class "heel"/.test(missing[0].why) && missing[0].file === HINTS_FILE, JSON.stringify(missing));
  const extra = faultsOf(GOOD, { hints: { ...HINTS, jabroni: 'Commit to the bit.' } });
  check('a hint map with a key that is not a class fires, naming the key', extra.length === 1 && /"jabroni", which is not one of the instance's classes/.test(extra[0].why), JSON.stringify(extra));
  const blank = faultsOf(GOOD, { hints: { ...HINTS, heel: '  ' } });
  check('a blank hint fires', blank.length === 1 && /hint for the class "heel" is blank/.test(blank[0].why), JSON.stringify(blank));
  const notText = faultsOf(GOOD, { hints: { ...HINTS, heel: 7 } });
  check('a hint that is not text fires', notText.length === 1 && /is blank/.test(notText[0].why), JSON.stringify(notText));
  check('a missing hint map fires', fires(GOOD, /hint map is missing/, { hints: undefined }));
  check('an empty hint map fires once for each class', faultsOf(GOOD, { hints: {} }).length === 2);
}

/* ---- markers ---- */
{
  const r = faultsOf('## A\n\n<!-- kayfabb:leaderboard -->\n');
  check('a marker the engine does not know fires, naming it and the ones it knows', r.length === 1 && /"kayfabb:leaderboard"/.test(r[0].why) && /letter, reactions, classes, cards/.test(r[0].why) && r[0].line === 3, JSON.stringify(r));
  check('each of the engine\'s four markers is clean', faultsOf('## A\n\n<!-- kayfabb:letter -->\n\n<!-- kayfabb:reactions -->\n\n<!-- kayfabb:classes -->\n\n<!-- kayfabb:cards -->\n').length === 0);
  check('a marker after a paragraph is still read', faultsOf('## A\n\nText\n\n<!-- kayfabb:nope -->\n').length === 1);
  check('a marker that shares its line with words would be shown as text, and fires', fires('## A\n\nSee <!-- kayfabb:classes --> here.\n', /does not stand alone/));
  check('an ordinary comment is clean, whatever it says', faultsOf('## A\n\n<!-- kayfabb is a game; 30 days; {{setting:nope}} -->\n\nText.\n').length === 0);
}

/* ---- settings ---- */
{
  const r = faultsOf('## A\n\nA wallet holds {{setting:walletCapp}} orbs.\n');
  check('a {{setting:}} path the settings do not have fires, naming it and its line', r.length === 1 && /\{\{setting:walletCapp\}\}/.test(r[0].why) && r[0].line === 3, JSON.stringify(r));
  check('a path to a setting that is not a number or a span fires', fires('## A\n\nMode {{setting:registrationMode}}.\n', /registrationMode/));
  check('a map with no key fires', fires('## A\n\n{{setting:cardEconomy}} here.\n', /cardEconomy/));
  check('a map key the map does not have fires', fires('## A\n\n{{setting:cardEconomy.nope.price}} here.\n', /nope/));
  check('a setting in a list, a table, a heading and a link is read too', faultsOf('## {{setting:nope1}}\n\n- {{setting:nope2}}\n\n| A |\n| --- |\n| {{setting:nope3}} |\n\n[{{setting:nope4}}](/x)\n').length === 4);
  check('a malformed {{…}} that is not a marker fires', fires('## A\n\nA {{setting:wallet cap}} here.\n', /not a \{\{setting/));
  check('the wallet, a count, a span and a card\'s price are all clean', faultsOf('## A\n\n{{setting:walletCap}} {{setting:reactionCap}} {{setting:turnCooldown}} {{setting:cardEconomy.whoops.price}} {{setting:cardEconomy.lurker.crowd}}\n').length === 0);
}

/* ---- a fragment link ---- */
{
  const r = faultsOf('## Aura\n\nSee [the nope](#nope).\n');
  check('a #fragment link that names no section fires, naming it and its line', r.length === 1 && /#nope/.test(r[0].why) && r[0].line === 3, JSON.stringify(r));
  check('a #fragment link to a section is clean, in a paragraph, a list and a table', faultsOf('## Aura\n\n[a](#aura)\n\n- [b](#aura)\n\n| H |\n| --- |\n| [c](#aura) |\n').length === 0);
  check('a second section of one title is #title-2, as the page names it', faultsOf('## Aura\n\n## Aura\n\n[a](#aura-2)\n').length === 0 && faultsOf('## Aura\n\n[a](#aura-2)\n').length === 1);
  check('a link to a path or an address is not a fragment and is left alone', faultsOf('## Aura\n\n[a](/updates#x) [b](https://example.com/#y)\n').length === 0);
}

/* ---- a retyped number ---- */
{
  const retyped = [
    ['6.00 orbs', '## A\n\nA wallet holds 6.00 orbs.\n'],
    ['30 days', '## A\n\nA Turn waits 30 days.\n'],
    ['a spelled number', '## A\n\nYou can play up to six characters.\n'],
    ['a number, a word, a unit', '## A\n\nYou can leave 3 more reactions.\n'],
    ['a hyphenated span', '## A\n\nIt is a 30-day wait.\n'],
    ['minutes', '## A\n\nIt takes about 20 minutes.\n'],
    ['two weeks', '## A\n\nIt lasts two weeks.\n'],
    ['in a list', '## A\n\n- A character costs 1 invite.\n'],
    ['in a heading', '## Seven days\n'],
    ['in a table cell', '## A\n\n| Wait |\n| --- |\n| 5 days |\n'],
    ['in bold', '## A\n\nUp to **three** reactions.\n'],
    ['in a block quote', '## A\n\n> Up to 9 orbs.\n'],
  ];
  for (const [name, markdown] of retyped) {
    const r = faultsOf(markdown);
    check(`a retyped number fires: ${name}`, r.length >= 1 && r.every((f) => /typed into the prose/.test(f.why)), JSON.stringify(r));
  }
  const clean = [
    ['a marker beside a unit', 'A wallet holds {{setting:walletCap}} orbs and {{setting:charactersPerPlayer}} characters.'],
    ['the pronoun "one"', 'Leave one reaction, and one is enough for a character.'],
    ['four corners', 'The map has four corners, and each is a way to play.'],
    ['three words that are not units', 'Three words on every card are worth knowing.'],
    ['an ordinal', 'The second day and the first reaction.'],
    ['a number beside a word the settings do not name', 'There are 16 emoji and 2 rows.'],
    ['a version', 'Pre-alpha 0.1 is all there is.'],
  ];
  for (const [name, text] of clean) {
    const r = faultsOf(`## A\n\n${text}\n`);
    check(`not a retyped number: ${name}`, r.length === 0, JSON.stringify(r));
  }
}

/* ---- the real tree: poisoned, then as it is ---- */
{
  const { tree, names } = instanceNames();
  check('git lists an instance with a UI', names.length >= 1 && names.every((n) => tree.has(`instances/${n}/guide/strategy-guide.md`) && tree.has(`instances/${n}/guide/hints.ts`)), JSON.stringify(names));
  for (const name of names) {
    const real = await readInstance(name);
    check(`${name}: the real guide holds the engine's markers and a line of prose to read`, real.markdown.includes('kayfabb:classes') && real.markdown.includes('{{setting:'));
    check(`${name}: the real hints are the real classes`, JSON.stringify(Object.keys(real.hints).sort()) === JSON.stringify([...real.classKeys].sort()), JSON.stringify([Object.keys(real.hints), real.classKeys]));
    const without = { ...real.hints };
    delete without[real.classKeys[0]];
    check(`${name}: the real hints with a class dropped fire`, guideFaults({ ...real, hints: without }).length === 1);
    check(`${name}: the real guide with an unknown marker appended fires`, guideFaults({ ...real, markdown: `${real.markdown}\n\n<!-- kayfabb:leaderboard -->\n` }).length === 1);
    check(`${name}: the real guide with an unknown setting appended fires`, guideFaults({ ...real, markdown: `${real.markdown}\n\nA {{setting:walletCapp}}.\n` }).length === 1);
    check(`${name}: the real guide with a retyped number appended fires`, guideFaults({ ...real, markdown: `${real.markdown}\n\nA wallet holds 6.00 orbs.\n` }).length === 1);
    check(`${name}: the real guide with a link to no section appended fires`, guideFaults({ ...real, markdown: `${real.markdown}\n\n[x](#nope)\n` }).length === 1);
    const LINE = 'Built, and not switched on here yet:';
    check(`${name}: the real guide holds the not-switched-on line while the instance has The System off`, real.settings.systemEnabled === false && real.markdown.includes(LINE));
    check(`${name}: the real guide with the not-switched-on line removed fires`, guideFaults({ ...real, markdown: real.markdown.replace(LINE, 'Built:') }).length === 1);
    check(`${name}: the real guide against settings with The System on fires`, guideFaults({ ...real, settings: { ...real.settings, systemEnabled: true } }).length === 1);
    check(`${name}: a guide without the line is clean where The System is on`, guideFaults({ ...real, markdown: real.markdown.replace(LINE, 'Built:'), settings: { ...real.settings, systemEnabled: true } }).length === 0);
    const r = guideFaults(real);
    check(`${name}: the real guide is clean`, r.length === 0, JSON.stringify(r));
  }
}

console.log(`\n  guide: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-guide: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
