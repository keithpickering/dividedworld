/**
 * Guard: an instance's Strategy Guide is its Markdown and its hints, and both are held to the instance they describe.
 *
 *   node tools/check-guide.mjs
 *
 * The guide is prose an instance writes (docs/plans/2026-11-02-onboarding-design.md, section 8), and the engine fills the parts that must
 * stay true after a retune: the class list, the reaction grid, the card table and every number, as markers in the Markdown
 * (engine/ui/guide/markdown.ts). A marker the engine does not know draws nothing, a `{{setting:path}}` the settings do not have draws a
 * dash, a class with no hint is a class card the guide cannot finish, and a number typed into the prose is true until the next retune
 * and a lie after it. None of them changes a test or a screen the owner is likely to open, so the files are read on every build.
 *
 * Read: `instances/<name>/guide/strategy-guide.md` and `guide/hints.ts` of every instance that has a `ui/index.ts`, against that
 * instance's classes and settings (`instances/<name>/index.ts`), loaded as the engine's tests load them. It refuses
 *
 *  - a hint map whose keys are not exactly the instance's classes, or a hint that is blank;
 *  - a marker the engine does not know, and a marker that does not stand alone on its line (it would be shown as text);
 *  - a `{{setting:path}}` the settings do not have or that is not a number or a span (the page says the same thing: `settingText`),
 *    and a `{{` that is not a marker at all;
 *  - a bare number in the prose next to a word the settings name ("6.00 orbs", "30 days", "up to six characters"), a heuristic for a
 *    retyped setting. A number beside any other word is the prose's own ("four corners") and is left alone; "one" is a pronoun as often
 *    as a number and is left alone too. A comment is for the author and is not read. There is no escape hatch, on purpose: the remedy
 *    for a flagged number is to reword the sentence or say it with a marker, never to silence the check. The heuristic misses what
 *    it is not shaped to see: a number beside a unit with two words between ("30 whole long days"), a unit it does not list, a figure
 *    in a link's address or in code, a number split by markup, and one word standing for a number ("a dozen", "one"); it is a net for
 *    the common retype, not a proof that none is left;
 *  - a `#fragment` link that names no section: a section's anchor is its second-level heading's words, as the page makes it
 *    (`sectionsOf`), so a link to `#nope` or to a heading since renamed would scroll nowhere;
 *  - a conditional passage (`<!-- kayfabb:if system-on|system-off -->` to `<!-- kayfabb:end -->`) that is malformed: a condition the
 *    engine does not know, an `if` inside an `if`, an `if` never closed, an `end` that closes nothing, or a second-level heading inside
 *    one (the contents and the links must be the same whichever way the switch is). The check reads both branches of a passage as it
 *    reads the rest of the guide, so a marker, a setting, a link, a `{{`, a retyped number inside either is found as outside it;
 *  - the words "not switched on" (case-blind) anywhere but inside a `system-off` passage. The guide used to be tied to the switch by an
 *    exact sentence, "Built, and not switched on here yet:", required while `systemEnabled` was false and refused while it was true. That
 *    failed the build the day the launch flipped the switch, and a rule about one string could not tell a guide that was right from one
 *    that merely avoided the string. The guide now holds both branches and the switch picks (docs/plans/2026-11-21-gabes-voice-design.md,
 *    section 5), so the check no longer reads the switch at all: what it refuses is a sentence that would be untrue the day the staff are
 *    switched on, which is any such claim outside a passage only shown while they are off.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass. The detection is exported and pure so
 * tools/test-guide.mjs drives every branch red. (The plan named the pair test-check-guide.mjs; tools/build.mjs pairs a check with
 * `test-<name>.mjs`, and refuses any other, so it is this name.)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * The engine's own reader of the guide, so the check and the page agree on what a marker and a setting are. It is TypeScript, which node
 * strips as it loads; the specifier is built, not written, so the tools' type check (tsconfig.tools.json, which reads .mjs alone) does not
 * try to read the engine through it.
 */
let reader;
try {
  reader = await import(pathToFileURL(path.join(repoRoot, 'engine/ui/guide/markdown.ts')).href);
} catch (error) {
  if (error?.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw error;
  console.error('  guide: this check needs Node 22.18 or later (type stripping), to read the engine\'s TypeScript; this is Node ' + process.versions.node);
  process.exit(1);
}
const { CONDITIONS, inlineText, MARKERS, parse, sectionsOf, settingText } = reader;

export const UI_INDEX = /^instances\/([^/]+)\/ui\/index\.ts$/;
export const GUIDE_FILE = (name) => `instances/${name}/guide/strategy-guide.md`;

/* ------------------------------------------------------------------- a retyped number ---- */

const NUMBER_WORDS = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand';
/** The words the settings name a quantity of: Aura's orbs, the cap on characters, reactions and invites, and every span's unit. */
export const UNIT_WORDS = 'orbs?|characters?|reactions?|invites?|posts?|seconds?|minutes?|hours?|days?|weeks?|months?|years?';
/** A number (digits, or a number word but one), at most one word, then a unit word: "6.00 orbs", "30-day", "up to six characters", "3 more reactions". */
const RETYPED = new RegExp(`(?<![\\w.])(\\d[\\d,.]*%?|${NUMBER_WORDS})(?:-|\\s+)(?:[A-Za-z'’]+\\s+)?(${UNIT_WORDS})\\b`, 'giu');

/**
 * A multiplier or a fraction said in words: "double", "triple", "twice", "half", "a fifth", "two thirds", "a quarter", and a number word
 * then "times" ("four times over"). "doubled" (a card frame) and "one" (a pronoun) are not these and are left alone.
 */
const FRACTIONS = 'half|halves|thirds?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|quarters?';
const COUNT_WORDS = `one|${NUMBER_WORDS}`;
const RETYPED_WORD = new RegExp(`(?<![\\w-])(double|triple|quadruple|twice|thrice|half|(?:an?|${COUNT_WORDS})\\s+(?:${FRACTIONS})|(?:${COUNT_WORDS})\\s+times)(?![\\w-])`, 'giu');

/** The words of a block, a setting marker said as a placeholder that is neither a digit nor a word, so a marker beside a unit is clean. */
function words(block) {
  const say = () => '§';
  switch (block.t) {
    case 'heading':
    case 'p': return [inlineText(block.children, say)];
    case 'ul':
    case 'ol': return block.items.map((i) => inlineText(i, say));
    case 'quote':
    case 'when': return block.blocks.flatMap(words);
    case 'table': return [...block.head, ...block.rows.flat()].map((c) => inlineText(c, say));
    default: return [];
  }
}

/** Every marker block and every `{{setting:}}` path in a tree, with the text of each paragraph for the checks that read prose. */
function walk(blocks, visit, inWhen = false) {
  const inlines = (nodes) => {
    for (const n of nodes) {
      if (n.t === 'setting') visit.setting?.(n.path);
      else if (n.t === 'link') { visit.link?.(n.href); inlines(n.children); }
      else if (n.t === 'strong' || n.t === 'em') inlines(n.children);
    }
  };
  for (const b of blocks) {
    if (b.t === 'marker') visit.marker?.(b.name);
    else if (b.t === 'when') walk(b.blocks, visit, true);
    else if (b.t === 'heading' || b.t === 'p') {
      if (b.t === 'heading' && b.level === 2 && inWhen) visit.sectionInWhen?.(inlineText(b.children));
      inlines(b.children);
    }
    else if (b.t === 'ul' || b.t === 'ol') b.items.forEach(inlines);
    else if (b.t === 'quote') walk(b.blocks, visit, inWhen);
    else if (b.t === 'table') [...b.head, ...b.rows.flat()].forEach(inlines);
  }
}

/** Every paragraph, heading, list item and table cell in a tree with the switch it is shown under (null outside any passage), a setting said as `words` says it. */
function spoken(blocks, system = null) {
  return blocks.flatMap((b) => (b.t === 'when' ? spoken(b.blocks, b.system) : b.t === 'quote' ? spoken(b.blocks, system) : words(b).map((text) => ({ text, system }))));
}

/**
 * The lines of the Markdown a conditional's faults stand on, in the order the reader names them: an `if` inside an open one, an `end` with
 * nothing open, and an `if` still open at the end. The reader rewrites those lines into markers, so they are found here from the source.
 */
function conditionalLines(markdown) {
  const nested = [];
  const stray = [];
  const open = [];
  markdown.split('\n').forEach((raw, i) => {
    const t = raw.trim();
    if (/^<!--\s*kayfabb:if(?:\s[^>]*)?-->$/u.test(t)) { if (open.length) nested.push(i + 1); open.push(i + 1); }
    else if (/^<!--\s*kayfabb:end\s*-->$/u.test(t)) { if (open.length) open.pop(); else stray.push(i + 1); }
  });
  return { 'if-nested': nested, end: stray, 'if-unclosed': open };
}

/** The 1-based line of the first line of the Markdown holding `snippet`, or 0 when none does (a heading broken over lines, say). */
function lineOf(markdown, snippet) {
  const at = markdown.split('\n').findIndex((l) => l.includes(snippet));
  return at < 0 ? 0 : at + 1;
}

/**
 * The faults of one instance's guide. `settings` is what the page can say: the instance's compiled settings with its card economy under
 * the name the screens read it by (`cardEconomy`), the same shape `settingText` reads at runtime.
 *
 * @param {{ file: string, markdown: string, hints: Record<string, unknown> | undefined, hintsFile?: string, classKeys: readonly string[], settings: object }} guide
 * @returns {{ file: string, line: number, why: string }[]}
 */
export function guideFaults({ file, markdown, hints, hintsFile = file.replace(/strategy-guide\.md$/, 'hints.ts'), classKeys, settings }) {
  const out = [];
  const fault = (f, line, why) => out.push({ file: f, line, why });

  /* The hints: exactly the instance's classes, each a line. */
  if (hints === undefined || typeof hints !== 'object' || hints === null) fault(hintsFile, 1, 'the hint map is missing: guide/hints.ts exports `hints`, one line for each class');
  else {
    for (const key of classKeys) if (!Object.hasOwn(hints, key)) fault(hintsFile, 1, `the hint map has no hint for the class "${key}"`);
    for (const key of Object.keys(hints)) if (!classKeys.includes(key)) fault(hintsFile, 1, `the hint map has a hint for "${key}", which is not one of the instance's classes`);
    for (const key of classKeys) {
      if (Object.hasOwn(hints, key) && (typeof hints[key] !== 'string' || hints[key].trim() === '')) fault(hintsFile, 1, `the hint for the class "${key}" is blank`);
    }
  }

  const blocks = parse(markdown);

  /* Markers and settings the engine can fill. */
  const lines = conditionalLines(markdown);
  walk(blocks, {
    marker: (name) => {
      if (name === 'if-nested') fault(file, lines[name].shift() ?? 0, 'a conditional passage stands inside another');
      else if (name === 'if-unclosed') fault(file, lines[name].shift() ?? 0, 'a conditional passage is never closed with kayfabb:end');
      else if (name === 'end') fault(file, lines[name].shift() ?? 0, 'kayfabb:end closes nothing');
      else if (name === 'if' || name.startsWith('if ')) {
        const condition = name.slice(2).trim();
        fault(file, lineOf(markdown, `kayfabb:${name}`) || lineOf(markdown, 'kayfabb:if'), `the condition "${condition}" is not one the engine knows (${CONDITIONS.join(', ')})`);
      } else if (!MARKERS.includes(name)) fault(file, lineOf(markdown, `kayfabb:${name}`), `the marker "kayfabb:${name}" is not one the engine knows (${MARKERS.join(', ')})`);
    },
    setting: (p) => {
      if (settingText(p, settings) === undefined) fault(file, lineOf(markdown, `{{setting:${p}`), `{{setting:${p}}} names no setting the page can say (a number or a span, by the name the screens read it)`);
    },
    sectionInWhen: (title) => fault(file, lineOf(markdown, title), `the section "${title}" stands inside a conditional passage: a section cannot stand inside a conditional passage, since the guide's contents and its links must be the same whichever way the switch is`),
  });

  /* What the guide says of the staff is true whichever way the switch is: only a system-off passage may say they are not on. */
  for (const { text, system } of spoken(blocks)) {
    if (system !== 'off' && /not switched on/iu.test(text)) fault(file, lineOf(markdown, text.slice(0, 40)) || lineOf(markdown, text.match(/not switched on/iu)[0]), `"${text.slice(0, 60)}" says the staff are not switched on outside a system-off passage, so it would be untrue the day they are switched on`);
  }

  /* A link to a fragment names a section, by the anchor the page gives it (`sectionsOf`, the page's own reading). */
  const anchors = new Set(sectionsOf(blocks, (p) => settingText(p, settings) ?? '—').map((x) => x.id));
  walk(blocks, {
    link: (href) => {
      if (href.startsWith('#') && !anchors.has(href.slice(1))) fault(file, lineOf(markdown, `](${href}`), `the link to "${href}" names no section of the guide (the sections are ${[...anchors].map((a) => `#${a}`).join(', ') || 'none'})`);
    },
  });

  /* Text the reader would otherwise see as a broken marker. */
  for (const block of blocks) {
    for (const text of words(block)) {
      if (/\{\{/u.test(text)) fault(file, lineOf(markdown, '{{'), `"${text.slice(0, 60)}" holds a "{{" that is not a {{setting:<path>}} marker`);
      if (/kayfabb:/u.test(text)) fault(file, lineOf(markdown, 'kayfabb:'), `"${text.slice(0, 60)}" names a marker that does not stand alone on its line, so it would be shown as text`);
    }
  }

  /* A number typed beside a word the settings name. */
  for (const block of blocks) {
    for (const text of words(block)) {
      for (const m of text.matchAll(RETYPED)) {
        fault(file, lineOf(markdown, m[0]) || lineOf(markdown, m[1]), `"${m[0]}" is a number typed into the prose beside "${m[2]}"; say it with {{setting:<path>}} so a retune cannot make it untrue`);
      }
    }
  }
  for (const block of blocks) {
    for (const text of words(block)) {
      for (const m of text.matchAll(RETYPED_WORD)) {
        fault(file, lineOf(markdown, m[0]), `"${m[0]}" is a multiplier or a fraction typed into the prose; say it with {{setting:<path>}}, or without an amount, so a retune cannot make it untrue`);
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------------- the real tree ---- */

/** The settings as the page reads them: the compiled ones, and the economy under the name `screen_settings` gives it. */
export const screenSettingsOf = (settings) => ({ ...settings, cardEconomy: settings.economy ?? {} });

/** Each instance with a UI, by name, from git. */
export function instanceNames() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  return { tree: new Set(tree), names: tree.map((p) => UI_INDEX.exec(p)?.[1]).filter(Boolean) };
}

/** An instance's guide, its hints, its classes and its settings, loaded as the engine's own tests load them. */
export async function readInstance(name) {
  const file = GUIDE_FILE(name);
  const markdown = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const { hints } = await import(pathToFileURL(path.join(repoRoot, `instances/${name}/guide/hints.ts`)).href);
  const { instance } = await import(pathToFileURL(path.join(repoRoot, `instances/${name}/index.ts`)).href);
  return { file, markdown, hints, classKeys: instance.classes.map((c) => c.key), settings: screenSettingsOf(instance.settings) };
}

async function main() {
  const { tree, names } = instanceNames();
  /* A guard reading nothing would pass; the repository holds an instance, so an empty read is a broken read. */
  if (names.length === 0) {
    console.error('  guide: no instance with a ui/index.ts was found, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = [];
  for (const name of names) {
    const file = GUIDE_FILE(name);
    if (!tree.has(file) || !tree.has(`instances/${name}/guide/hints.ts`) || !fs.existsSync(path.join(repoRoot, file))) {
      faults.push({ file, line: 1, why: `the instance "${name}" has a UI and no tracked guide: it needs guide/strategy-guide.md and guide/hints.ts (InstanceUi.guide)` });
      continue;
    }
    faults.push(...guideFaults(await readInstance(name)));
  }
  if (faults.length) {
    console.error(`  guide: ${faults.length} departure(s) from the guide contract:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.why}`);
    console.error('  A guide says every number with {{setting:<path>}}, fills lists with the engine\'s markers, and has a hint for each class\n  (docs/plans/2026-11-02-onboarding-plan.md, Task 8).');
    process.exit(1);
  }
  console.log(`  guide: ${names.length} instance guide(s), every marker and setting known, a hint for each class, no number typed into the prose`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
