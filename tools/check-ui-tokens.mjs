/**
 * Guard: the engine's screens take every color, font family and border color from a token.
 *
 *   node tools/check-ui-tokens.mjs
 *
 * A theme is a CSS file of overrides (docs/plans/2026-10-29-screens-design.md, section 12): it
 * sets the `--kb-` tokens engine/ui/tokens.css names, and every screen reads them. A literal
 * written anywhere else in engine/ui/ (a `#fff` in a style object, a `font-family: Arial` in
 * base.css, an SVG's `fill="black"`) is one instance's look baked into the engine, and no theme
 * can reach it. It changes no test and looks right in the house theme, which is why it is read
 * on every build rather than trusted.
 *
 * Read: every `.css`, `.ts` and `.tsx` under engine/ui/ but tokens.css, which holds the names and
 * their plain defaults, and but tests, which may assert a computed color. In a stylesheet each
 * declaration is read with comments and `url()` stripped; a color property's value may not hold a
 * hex, a color function (rgb, hsl, hwb, lab, lch, oklab, oklch, color) or a named color, and a font
 * family may only come from `var()`. A fallback inside `var()` is a literal too. In a script every
 * string, template and JSX attribute is read from the TypeScript AST, so a comment is never read:
 * any string that is a hex color or holds a color function fires, as does a hex anywhere in a
 * compound style value (`textDecoration: 'underline #000'`), and a named color or a family given
 * to a color or font key (`color`, `fill`, `fontFamily`, …), through a ternary or `&&` too.
 * Selectors are not values, so a class named `.kb-red` or an id `#fade` is clean. A screen's own
 * custom property (`--kb-local: #fff`) holding a literal fires too: only tokens.css sets values.
 *
 * The guard cannot tell a style object from a data object, and does not try: an engine object
 * that gives a color word to a `color` key fires, on purpose, because the engine names no color;
 * a color is an instance's (`InstanceUi.classLooks`), handed to the screens as a value.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass.
 * The detection is exported and pure so tools/test-ui-tokens.mjs drives every branch red.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files the guard reads. */
export const SOURCE = /^engine\/ui\/.*\.(css|ts|tsx)$/;
const EXEMPT = /^engine\/ui\/tokens\.css$|\.test\.tsx?$/;

/** CSS's named colors (CSS Color 4), lowercased. */
const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '
  + 'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen '
  + 'darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray '
  + 'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia '
  + 'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender '
  + 'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink '
  + 'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon '
  + 'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red '
  + 'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));

const HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** A CSS property whose value is (or holds) a color. */
const COLOR_PROP = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|outline(?:-color)?|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|column-rule(?:-color)?|text-decoration(?:-color)?|text-emphasis(?:-color)?|box-shadow|text-shadow|filter|backdrop-filter|scrollbar-color|border-image(?:-source)?|mask(?:-image)?|-webkit-mask(?:-image)?|-webkit-text-fill-color|-webkit-text-stroke(?:-color)?)$/i;

/** A JS style key or JSX attribute that takes a color. */
const COLOR_KEY = /^(?:color|background(?:Color|Image)?|border(?:Top|Right|Bottom|Left|Block|Inline)?(?:Start|End)?(?:Color)?|outline(?:Color)?|fill|stroke|stopColor|floodColor|lightingColor|caretColor|accentColor|boxShadow|textShadow|textDecorationColor|scrollbarColor)$/;
const FONT_KEY = /^(?:fontFamily|font)$/;
/** A JS style key whose value is a compound that may carry a color among other words: a hex anywhere in it is a color. */
const STYLE_VALUE_KEY = /^(?:color|background\w*|border\w*|outline\w*|fill|stroke|stopColor|floodColor|lightingColor|caretColor|accentColor|boxShadow|textShadow|textDecoration\w*|textEmphasis\w*|filter|backdropFilter|transition|animation|mask\w*|WebkitMask\w*|WebkitTextFillColor|WebkitTextStroke\w*|columnRule\w*|scrollbarColor)$/;

/** What the font shorthand may hold besides its family: sizes, weights, styles, keywords. */
const FONT_WORD = /^(?:normal|bold|bolder|lighter|italic|oblique|small-caps|inherit|initial|unset|revert|[\d.]+(?:px|em|rem|%|pt|ex|ch|vw|vh)?|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i;

/** A value with its `var(...)` calls removed (their fallbacks kept, since a fallback is a literal), and `url(...)` dropped. */
function bareValue(value) {
  let v = value.replace(/url\([^)]*\)/gi, ' ');
  /* var(--name) goes; var(--name, fallback) leaves its fallback, innermost first. */
  for (let i = 0; i < 8 && /var\(/i.test(v); i++) v = v.replace(/var\(\s*--[\w-]+\s*(?:,([^()]*(?:\([^()]*\))*[^()]*))?\)/gi, (_, fb) => ` ${fb ?? ''} `);
  return v;
}

/** A hex or a color function anywhere in a value, or null: a color under any property. */
function anyColor(value) {
  const v = bareValue(value);
  return v.match(HEX)?.[0] ?? v.match(COLOR_FN)?.[0] ?? null;
}

/** The literal a color value holds, or null. */
function colorLiteral(value) {
  const v = bareValue(value);
  const hex = v.match(HEX);
  if (hex) return hex[0];
  const fn = v.match(COLOR_FN);
  if (fn) return fn[0];
  for (const w of v.toLowerCase().match(/[a-z]+/g) ?? []) if (NAMED.has(w)) return w;
  return null;
}

/** The literal family a font-family or font value holds, or null. */
function fontLiteral(prop, value) {
  const v = bareValue(value).trim();
  if (!v) return null;
  if (prop === 'font-family' || prop === 'fontFamily') return /^(?:inherit|initial|unset|revert)$/i.test(v) ? null : v;
  const left = v.split(/[\s/,]+/).filter((w) => w && !FONT_WORD.test(w));
  return left.length ? left.join(' ') : null;
}

/** Every literal in one stylesheet, with its line. */
function cssFaults(file, text) {
  const out = [];
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const lineAt = (i) => bare.slice(0, i).split('\n').length;
  /* A declaration: a property, a colon, a value up to ; or }. A selector never holds `prop: value` before `{`, so only text inside braces is read. */
  let depth = 0;
  let start = -1;
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (c === '{') { depth++; start = i + 1; continue; }
    if (c === '}' || c === ';') {
      if (depth > 0 && start >= 0) read(start, i);
      if (c === '}') depth--;
      start = c === ';' || depth > 0 ? i + 1 : -1;
    }
  }
  function read(from, to) {
    const decl = bare.slice(from, to);
    const m = decl.match(/^\s*([-\w]+)\s*:([\s\S]*)$/);
    if (!m) return;
    const prop = m[1].toLowerCase();
    const at = from + decl.indexOf(m[1]);
    /* A hex or a color function is a color under any property, a custom one included: a screen's own --x: #fff is a literal no theme reaches. Quoted strings (content: "#1") are not values. */
    const unquoted = m[2].replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
    let literal = anyColor(unquoted);
    if (!literal && !prop.startsWith('--') && COLOR_PROP.test(prop)) literal = colorLiteral(m[2]);
    if (!literal && (prop === 'font' || prop === 'font-family')) literal = fontLiteral(prop, m[2]);
    if (literal) out.push({ file, line: lineAt(at), literal, why: `${prop} holds a literal; use a --kb- token from engine/ui/tokens.css` });
  }
  return out;
}

/** Every literal in one script, with its line. */
function scriptFaults(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  /** The key a string is given to: a property assignment's name or a JSX attribute's. */
  const keyOf = (node) => {
    /* Up through what passes a value along unchanged: parentheses, a ternary's branch, && || ??, a cast. */
    let n = node;
    for (;;) {
      const p = n.parent;
      if (!p) return null;
      if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p)) { n = p; continue; }
      if (ts.isConditionalExpression(p) && p.condition !== n) { n = p; continue; }
      if (ts.isBinaryExpression(p) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) { n = p; continue; }
      if (ts.isJsxExpression(p)) { n = p; continue; }
      break;
    }
    const p = n.parent;
    if (ts.isPropertyAssignment(p) && p.initializer === n) {
      if (ts.isComputedPropertyName(p.name)) return ts.isStringLiteralLike(p.name.expression) ? p.name.expression.text : null;
      return p.name.getText(source).replace(/^['"]|['"]$/g, '');
    }
    if (ts.isJsxAttribute(p)) return p.name.getText(source);
    return null;
  };
  const visit = (node) => {
    let s = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) s = node.text;
    else if (ts.isTemplateExpression(node)) s = [node.head.text, ...node.templateSpans.map((t) => t.literal.text)].join(' ');
    else if (ts.isJsxText(node)) s = null;
    if (s !== null) {
      const key = keyOf(node);
      let literal = null;
      const whole = s.trim();
      if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(whole)) literal = whole;
      else if (key && STYLE_VALUE_KEY.test(key) && HEX.test(bareValue(s))) literal = bareValue(s).match(HEX)?.[0] ?? null;
      else if (COLOR_FN.test(bareValue(s))) literal = bareValue(s).match(COLOR_FN)?.[0] ?? null;
      else if (key && COLOR_KEY.test(key)) literal = colorLiteral(s);
      else if (key && FONT_KEY.test(key)) literal = fontLiteral(key === 'font' ? 'font' : 'fontFamily', s);
      /* A CSS string inside a script (a template of declarations) is read as a stylesheet's body. */
      if (!literal && /[-\w]+\s*:/.test(s) && /;|^\s*[-\w]+\s*:/.test(s)) literal = cssFaults(file, `x{${s}}`)[0]?.literal ?? null;
      if (literal) out.push({ file, line: lineOf(node), literal, why: `${key ? `${key} is given` : 'a string holds'} a literal; use a --kb- token from engine/ui/tokens.css` });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * Every literal in a set of files, as `{ file, line, literal, why }`; [] is clean.
 * @param {Record<string, string>} files repository path to text
 */
export function tokenFaults(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    if (!SOURCE.test(file) || EXEMPT.test(file)) continue;
    out.push(...(file.endsWith('.css') ? cssFaults(file, text) : scriptFaults(file, text)));
  }
  return out;
}

/** The tracked engine/ui sources, read from disk. */
export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if (SOURCE.test(p) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  /* A guard reading nothing would pass; the screens' tokens file is always there, so an empty read is a broken read. */
  if (!('engine/ui/tokens.css' in files)) {
    console.error('  ui-tokens: engine/ui/tokens.css was not read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = tokenFaults(files);
  if (faults.length) {
    console.error(`  ui-tokens: ${faults.length} literal(s) in the engine's screens a theme cannot reach:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.literal}  ${f.why}`);
    console.error('  A theme is a CSS file of --kb- overrides (docs/plans/2026-10-29-screens-design.md, section 12).');
    process.exit(1);
  }
  console.log(`  ui-tokens: ${Object.keys(files).length} engine/ui file(s), every color and font from a token`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
