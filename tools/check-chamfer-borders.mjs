/**
 * Guard: a chamfered piece draws its border along the cut.
 *
 *   node tools/check-chamfer-borders.mjs
 *
 * A `clip-path: polygon(...)` that cuts a corner also cuts the border that runs across it: the 45 degree edge is left with
 * no line, and the piece reads as a box with a bite out of it (the welcome letter, the Updates post, the guide article, Gabe's
 * note, the season podium, the settled rank card and the orbs state were each drawn so). Nothing else notices, because every behavior test finds the element and none looks at its edge.
 * The fix is engine/ui/glass/base.css's `.kb-glass-cut-panel`, `-dialog` and `-button`: the element is the border's color,
 * cut, and its ::after is the panel one border in and cut by the line moved in by 0.5858 of the border.
 *
 * An `outline` counts as a border: the pieces this guard was written for drew their edge with one, and the clip cuts it
 * the same.
 *
 * Read: every `.css` tracked under engine/ and instances/, except engine/ui/glass/base.css (the cut itself), comments
 * blanked. A rule that sets a `clip-path` (or `-webkit-clip-path`) with `polygon(` and any `border`, `border-*` or `outline` width other than `0` (or a style of `none` or `hidden`) is
 * refused, naming the file, the selector and the line of the clip-path. A rule whose cut already runs its border along the
 * diagonal (the Lens's plates, the marks) opts out with a comment on the line above its selector or above its clip-path:
 *
 *   /* chamfer: border drawn on the cut by <how> *\/
 *
 * and the comment must say how; one with nothing after "by" is refused.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass. The detection is exported and pure
 * so tools/test-chamfer-borders.mjs drives it red on a bordered polygon.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IN_SCOPE = /^(engine|instances)\/.*\.css$/;
const THE_CUT = 'engine/ui/glass/base.css';
const OPT_OUT = /^\s*\/\*\s*chamfer:(.*?)\*\/\s*$/;
const HOW = /^\s*border drawn on the cut by\s+\S/;

/** Blank every comment, keeping each newline, so a character keeps its line. */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Is this declaration a border width other than zero or none? */
function isBorderWidth(prop, value) {
  const v = value.trim().toLowerCase();
  /* An outline is the border the clip cuts just the same (the welcome letter's was one). */
  /* A shorthand whose style is none or hidden draws no line, whatever its width. */
  const noLine = /(^|\s)(none|hidden)(\s|$)/.test(v);
  if (prop === 'outline') return !noLine && !/^0(px|em|rem)?(\s|$)/.test(v);
  if (prop === 'outline-width') return !/^0(px|em|rem)?$/.test(v);
  if (prop === 'border' || /^border-(top|right|bottom|left|block|inline)(-start|-end)?$/.test(prop)) return !noLine && !/^0(px|em|rem)?(\s|$)/.test(v);
  if (prop === 'border-width' || /^border-(top|right|bottom|left|block|inline)(-start|-end)?-width$/.test(prop)) {
    return v.split(/\s+/).some((t) => !/^0(px|em|rem)?$/.test(t));
  }
  return false;
}

/**
 * The rules that cut a corner with a polygon and have a border, not saying how the border is drawn on the cut.
 * @param {Record<string, string>} files path -> stylesheet text
 * @returns {{ file: string, selector: string, line: number, why: string }[]}
 */
export function chamferFaults(files) {
  const faults = [];
  for (const [p, raw] of Object.entries(files)) {
    if (!IN_SCOPE.test(p) || p === THE_CUT) continue;
    const lines = raw.split('\n');
    const text = blankComments(raw);
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    /* The opt-out comment on the line above a 1-based line, or null. */
    const optOutAbove = (line) => {
      const m = line >= 2 ? OPT_OUT.exec(lines[line - 2]) : null;
      return m ? m[1] : null;
    };
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      const bodyStart = m.index + m[0].indexOf('{') + 1;
      const clip = /(^|[;\s])(?:-webkit-)?clip-path\s*:\s*([^;]*)/.exec(body);
      if (!clip || !/polygon\(/.test(clip[2])) continue;
      let bordered = false;
      for (const d of body.split(';')) {
        const c = d.indexOf(':');
        if (c > 0 && isBorderWidth(d.slice(0, c).trim().toLowerCase(), d.slice(c + 1))) bordered = true;
      }
      if (!bordered) continue;
      const selector = m[1].trim().replace(/\s+/g, ' ');
      const clipLine = lineOf(bodyStart + clip.index + clip[1].length);
      const selLine = lineOf(m.index + m[1].search(/\S/));
      const said = [optOutAbove(selLine), optOutAbove(clipLine)].filter((s) => s !== null);
      if (said.some((s) => HOW.test(s))) continue;
      faults.push({
        file: p,
        selector,
        line: clipLine,
        why: said.length ? 'its chamfer comment does not say how the border is drawn on the cut' : 'a border under a polygon clip-path has no line along the cut',
      });
    }
  }
  return faults;
}

export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if (IN_SCOPE.test(p) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

/** A guard reading no stylesheet would pass over nothing. */
export function readNothing(files) {
  return !Object.keys(files).some((f) => f.endsWith('.css'));
}

function main() {
  const files = treeFiles();
  if (readNothing(files)) {
    console.error('  chamfer-borders: no stylesheet was read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = chamferFaults(files);
  if (faults.length) {
    console.error(`  chamfer-borders: ${faults.length} rule(s) with a border under a polygon clip-path:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.selector}  (${f.why})`);
    console.error('  Take the glass cut (.kb-glass-cut-panel, -dialog or -button in engine/ui/glass/base.css), or where the border already runs on the cut, say so above the rule: /* chamfer: border drawn on the cut by <how> */');
    process.exit(1);
  }
  console.log(`  chamfer-borders: ${Object.keys(files).length} file(s), every polygon-cut rule with a border draws it on the cut`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
