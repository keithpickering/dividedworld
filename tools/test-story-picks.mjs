/**
 * Tests for the guard in tools/check-story-picks.mjs.
 *
 *   node tools/test-story-picks.mjs
 *
 * The guard holds "an engine story names its card by key": in a story, a world or engine/ui/story.tsx, an
 * instance's pool of cards (`instance.cards`, `ui.cards`) is used whole or looked up through `cardOf`, and
 * never picked by place or by predicate. A pick by place passes its own PR and turns red a later card build
 * that does not edit it, so each way of taking the first of something is planted here and must fire, with
 * its file and line, and each way of using the pool whole, or of looking like a pool without being one,
 * must stay clean. The last case runs the guard over the real tree, so a guard that has gone quiet over
 * nothing fails here.
 */
import { storyPickFaults, treeFiles } from './check-story-picks.mjs';

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

const STORY = 'engine/ui/cards/Thing.stories.tsx';
const faultsOf = (text, path = STORY) => storyPickFaults([{ path, text }]);
/** A planted pick must produce exactly one fault, naming the file and the line, and the way to write it. */
const names = (text, line, path = STORY) => {
  const r = faultsOf(text, path);
  const ok = r.length === 1 && r[0].path === path && r[0].line === line
    && r[0].message.includes(`${path}:${line}`) && r[0].message.includes("cardOf(instance.cards, '<key>')") && r[0].message.includes('engine/ui/story.tsx');
  return { ok, detail: JSON.stringify(r) };
};
/** A line of padding first, so a fault on line 2 shows the line is read and not assumed. */
const at2 = (code) => `import { instance } from './x';\n${code}\n`;

/* ---- every way of picking from the pool, which must fire ---- */
for (const [label, code] of [
  ['an index: instance.cards[0]', 'export const a = instance.cards[0];'],
  ['an array destructuring', 'const [first, second] = instance.cards;'],
  ['an object destructuring: const { cards } = instance', 'const { cards } = instance;'],
  ['.find by predicate', "export const a = instance.cards.find((c) => c.reaction === true);"],
  ['.find by key, but not through cardOf', "export const a = instance.cards.find((c) => c.key === 'whoops');"],
  ['.filter', "export const a = instance.cards.filter((c) => c.rarity === 'common');"],
  ['.slice', 'export const a = instance.cards.slice(0, 3);'],
  ['.at on kayfa.ui.cards', 'export const a = kayfa.ui.cards.at(-1);'],
  ['.length', 'export const a = instance.cards.length;'],
  ['an assignment to another name', 'const pool = instance.cards;'],
]) {
  const r = names(at2(code), 2);
  check(`${label} fires, naming file and line`, r.ok, r.detail);
}

/* ---- the pool reached in other spellings ---- */
for (const [label, code] of [
  ['a cast pool, indexed', 'const a = (instance.cards as Card[])[0];'],
  ['a non-null owner', 'const a = instance!.cards[0];'],
  ['an optional-chained owner', 'const a = instance?.cards[0];'],
  ['a parenthesized pool through kayfa.instance', 'const a = (kayfa.instance.cards).find((c) => c.rare);'],
  ['an element access with the string "cards"', "const a = instance['cards'][0];"],
  ['an owner reached by a string index: ui', "const a = kayfa['ui'].cards[0];"],
  ['an owner reached by a string index: instance', "const a = kayfa['instance'].cards[0];"],
  ['an object destructuring from ui, with a rename', 'const { cards: pool } = ui;'],
  ['an object destructuring from kayfa.instance', 'const { gear, cards } = kayfa.instance;'],
  ['an object destructuring with a computed key', "const { ['cards']: c } = instance;"],
  ['an assignment destructuring, shorthand', 'let c;\n({ cards: c } = instance);'],
  ['an indexed pool inside a call argument (fires on the index)', 'f(instance.cards[0]);'],
  ['a spread into a call, not into an array', 'f(...instance.cards);'],
  ['a returned pool', 'const g = () => { return instance.cards; };'],
  ['an arrow body that is the pool', 'const g = () => instance.cards;'],
  ['a pool with a default: instance.cards ?? []', 'const a = instance.cards ?? [];'],
  ['a pool compared: instance.cards === y', 'const a = instance.cards === y;'],
  ['the pool handed to a constructor (only a call takes it whole)', 'const s = new Set(instance.cards);'],
  ['the pool as a condition', 'if (instance.cards) { use(); }'],
]) {
  /* the assignment-destructuring case needs its declaration first, so it fires on line 3 */
  const line = code.startsWith('let c;') ? 3 : 2;
  const r = names(at2(code), line);
  check(`${label} fires, naming file and line`, r.ok, r.detail);
}
{
  const r = names(at2('({ cards } = instance);'), 2);
  check('an assignment destructuring, shorthand: ({ cards } = instance) fires', r.ok, r.detail);
}
{
  const r = faultsOf(at2('if (instance.cards) { use(); }'));
  check('an unlisted use says so plainly, not with a SyntaxKind name in a sentence',
    r.length === 1 && /used in a way the guard does not allow \(IfStatement\)/.test(r[0].message) && !/used as a /.test(r[0].message), JSON.stringify(r));
}
{
  const r = faultsOf(at2('const g = () => instance.cards;'));
  check('the arrow-body pool is called returned', r.length === 1 && r[0].use === 'the pool returned', JSON.stringify(r));
}
{
  const r = faultsOf(at2('const a = instance.cards ?? [];'));
  check('a binary use is called assigned or compared', r.length === 1 && r[0].use === 'the pool assigned or compared', JSON.stringify(r));
}
check('a parameter destructuring ({ cards }: I) => ... is a known blind spot, left clean on purpose',
  faultsOf(at2('const f = ({ cards }: I) => cards[0];')).length === 0);
check('a spread or one-element array indexed afterward is a known blind spot, left clean on purpose',
  faultsOf(at2('const a = [...instance.cards][0];\nconst b = [instance.cards][0];')).length === 0);
check('a .map receiver indexed afterward is a known blind spot, left clean on purpose',
  faultsOf(at2('const a = instance.cards.map((c) => c.key)[0];')).length === 0);
check('a .map receiver followed by .find or .filter is a known blind spot, left clean on purpose',
  faultsOf(at2('const a = instance.cards.map((c) => c.key).find((k) => k);\nconst b = instance.cards.map((c) => c.key).filter((k) => k);')).length === 0);

/* ---- which files are read ---- */
{
  const r = names(at2('export const a = instance.cards[0];'), 2, 'engine/ui/profile/spritey-world.ts');
  check('a pick in a *-world.ts file fires', r.ok, r.detail);
}
{
  const r = names(at2('export const a = instance.cards[0];'), 2, 'engine/ui/story.tsx');
  check('a pick in engine/ui/story.tsx fires', r.ok, r.detail);
}
{
  const r = names(at2('export const a = ui.cards[0];'), 2, 'instances/divided-world/ui/whoops/Lens.board.stories.tsx');
  check('a pick in a story under instances/<name>/ fires', r.ok, r.detail);
}
check('a pick in a story outside engine/ and instances/ is not read',
  faultsOf(at2('const a = instance.cards[0];'), 'web/src/data/fixtures/stories.tsx').length === 0);
check('the same picks in X.test.tsx are not read',
  faultsOf(at2('const a = instance.cards[0];'), 'engine/ui/cards/Thing.test.tsx').length === 0);
check('the same picks in a file that is neither a story nor a world are not read',
  faultsOf(at2('const a = instance.cards[0];'), 'engine/ui/cards/Thing.tsx').length === 0
  && faultsOf(at2('const a = instance.cards[0];'), 'engine/rules/world.ts').length === 0);
check('a path that merely ends like engine/ui/story.tsx is not that file',
  faultsOf(at2('const a = instance.cards[0];'), 'engine/ui/mystory.tsx').length === 0);

/* ---- the pool used whole, and what only looks like a pool ---- */
check('cardOf(instance.cards, KEY) is clean', faultsOf(at2("const a = cardOf(instance.cards, 'whoops');")).length === 0);
check('facesOf(instance.cards, ui.cards, settings) is clean', faultsOf(at2('const a = facesOf(instance.cards, ui.cards, settings);')).length === 0);
check('for (const c of instance.cards) is clean', faultsOf(at2('for (const c of instance.cards) use(c);')).length === 0);
check('.map, .forEach, .some and .every on the pool are clean',
  faultsOf(at2('instance.cards.map((c) => c.key);\ninstance.cards.forEach((c) => use(c));\ninstance.cards.some((c) => c.rare);\ninstance.cards.every((c) => c.rare);')).length === 0);
check('a spread into an array, with an extra element, is clean', faultsOf(at2('const a = [...kayfa.ui.cards, EXTRA];')).length === 0);
check('the pool as an element of an array literal (a dependency list) is clean', faultsOf(at2('useMemo(() => 1, [instance, ui.cards]);\nconst b = [instance.cards, 1];')).length === 0);
check('player.cards.find(...) and log.cards.filter(...) are not an instance\'s pool',
  faultsOf(at2('player.cards.find((c) => c.key === k);\nlog.cards.filter((c) => c.ok);\nconst [x] = player.cards;\nconst { cards } = player;')).length === 0);
check('a pool-shaped name that only ends like one (myinstance, instances) is not the pool',
  faultsOf(at2('const a = myinstance.cards[0];\nconst b = instances.cards[0];')).length === 0);
check('instance.cards[0] inside a comment is not a pick', faultsOf(at2('// const a = instance.cards[0];\n/* instance.cards.find(x) */\nexport const b = 1;')).length === 0);
check('instance.cards[0] inside a string or a template text is not a pick',
  faultsOf(at2("export const doc = 'instance.cards[0]';\nexport const t = `uses ${1} instance.cards.slice(0)`;")).length === 0);
check('instance.classes[0] and instance.gear[0] are not cards', faultsOf(at2('const a = instance.classes[0];\nconst b = instance.gear[0];')).length === 0);

/* ---- several picks, each with its own line ---- */
{
  const r = faultsOf(`const a = instance.cards[0];\n\nconst b = ui.cards.slice(0, 2);\n`);
  check('two picks give two faults on their own lines', r.length === 2 && r[0].line === 1 && r[1].line === 3, JSON.stringify(r));
}

/* ---- the real tree ---- */
{
  const files = treeFiles();
  check('the guard reads the engine\'s stories, which cannot be none', files.some((f) => f.path.startsWith('engine/') && f.path.endsWith('.stories.tsx')) && files.some((f) => f.path === 'engine/ui/story.tsx'));
  const r = storyPickFaults(files);
  check('the real tree is clean', r.length === 0, r.map((f) => `${f.path}:${f.line}`).join(' '));
}

console.log(`\n  story-picks: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-story-picks: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
