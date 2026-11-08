/**
 * No dialog draws a frame of its own, in the engine or in an instance (engine/ui/glass/Frame.tsx; the glass polish plan, "Modals").
 * Read as text, over every component and stylesheet of both layers, so it lives here, in the composition root: the engine's
 * own test of the frame (engine/ui/glass/frame.test.tsx) may not read an instance's files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(root, f);

describe('the markup: no component draws a dialog frame', () => {
  test('no component draws a dialog box of its own: only Overlay and Float say role="dialog" with the glass', () => {
    const own = walk(path.join(root, 'engine'), '.tsx').concat(walk(path.join(root, 'instances'), '.tsx'), walk(path.join(root, 'web', 'src'), '.tsx'))
      .filter((f) => !/\.(test|stories|board\.stories)\.tsx$/u.test(f) && !/\.stories\.tsx$/u.test(f))
      .filter((f) => /role="dialog"/u.test(fs.readFileSync(f, 'utf8')))
      .map(rel).sort();
    /*
     * The board's own 2003 modal (modal.tsx), the tour's tip (Spotlight) and the pack's reveal (a full-window layer over the machine with no frame at
     * all, as its boards draw it: engine/ui/vending/PackOpening.tsx, on the glass's modal layer) are not glass dialogs; the other two are the frame's.
     */
    expect(own).toEqual(['engine/ui/glass/Float.tsx', 'engine/ui/glass/Overlay.tsx', 'engine/ui/modal.tsx', 'engine/ui/tips/Spotlight.tsx', 'engine/ui/vending/PackOpening.tsx']);
    for (const f of ['engine/ui/glass/Float.tsx', 'engine/ui/glass/Overlay.tsx']) expect(fs.readFileSync(path.join(root, f), 'utf8')).toContain('FRAME');
  });

  test('no component sets how Close looks', () => {
    for (const f of walk(path.join(root, 'engine'), '.tsx').concat(walk(path.join(root, 'instances'), '.tsx'))) {
      if (/\.test\.tsx$/u.test(f)) continue;
      expect(fs.readFileSync(f, 'utf8'), rel(f)).not.toMatch(/closeLook|data-kb-look="(cross|word)"|kb-lens-close/u);
    }
  });
});

describe('the stylesheets: no dialog draws its own frame', () => {
  /**
   * The classes that are a dialog's box: the frame's, and each `className` given to an `Overlay` or a `Float` in the engine or an instance,
   * read from the source (the AST), so a new dialog is held to the frame the moment it is written, with no list to add it to. A className
   * that is not a string the test can read (a variable, a call, a wrapper's pass-through) or a spread that could carry one is a dialog it
   * cannot see, and fails.
   */
  const FRAME_CLASSES = ['kb-glass-dialog', 'kb-glass-cut-dialog'];
  /** Each `className` string of an `<Overlay>` or `<Float>` in `text`, and the className expressions that could not be read as strings. */
  const dialogClasses = (text: string, file = 'x.tsx') => {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found = new Set<string>();
    const unread: string[] = [];
    const strings = (n: ts.Node): boolean => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { for (const c of n.text.split(/\s+/u)) if (c) found.add(c); return true; }
      if (ts.isConditionalExpression(n)) return strings(n.whenTrue) && strings(n.whenFalse);
      if (ts.isParenthesizedExpression(n)) return strings(n.expression);
      return false;
    };
    const visit = (n: ts.Node) => {
      const tag = ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n) ? n.tagName.getText(sf) : null;
      if (tag === 'Overlay' || tag === 'Float') {
        const attrs = (n as ts.JsxOpeningElement).attributes.properties;
        for (const a of attrs) if (ts.isJsxSpreadAttribute(a)) unread.push(`${file}: ${a.getText(sf)}`);
        const cls = attrs.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className');
        const init = cls?.initializer;
        const expr = init && ts.isJsxExpression(init) ? init.expression : init;
        if (expr && !strings(expr)) unread.push(`${file}: ${expr.getText(sf)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return { found, unread };
  };
  const source = walk(path.join(root, 'engine'), '.tsx').concat(walk(path.join(root, 'instances'), '.tsx'), walk(path.join(root, 'web', 'src'), '.tsx'))
    .filter((f) => !/\.(test|stories)\.tsx$/u.test(f));
  const derived = source.map((f) => ({ f: rel(f), ...dialogClasses(fs.readFileSync(f, 'utf8'), rel(f)) }));
  const BOXES = [...new Set([...FRAME_CLASSES, ...derived.flatMap((d) => [...d.found])])].sort();

  test('every className an Overlay or a Float is given is read, and the dialogs this repository has are among them', () => {
    expect(derived.flatMap((d) => d.unread)).toEqual([]);
    for (const c of ['kb-turn-dialog', 'kb-debut-dialog', 'kb-reveal-dialog', 'kb-vending-about-dialog', 'kb-queue-dialog', 'kb-move-overlay']) expect(BOXES, c).toContain(c);
  });

  test('a dialog planted in a component is found, and so is one a variable hides', () => {
    const planted = dialogClasses('const A = () => <Overlay title="x" className="kb-planted-dialog" onClose={f}>x</Overlay>; const B = () => <Float className={open ? "kb-planted-float kb-two" : \'kb-three\'} />;');
    expect([...planted.found].sort()).toEqual(['kb-planted-dialog', 'kb-planted-float', 'kb-three', 'kb-two']);
    expect(dialogClasses('const A = () => <Overlay className={cls} />;').unread).toHaveLength(1);
    /* A wrapper that passes its className through hides the class from every place it is used, so the wrapper itself is the unreadable one. */
    expect(dialogClasses('const W = ({ className }) => <Overlay title="x" className={className} onClose={f}>x</Overlay>;').unread).toHaveLength(1);
    expect(dialogClasses('const W = (p) => <Float className={`kb-a ${p.className}`} />;').unread).toHaveLength(1);
    /* A spread can carry a className too, which nothing here reads. */
    expect(dialogClasses('const W = (props) => <Overlay title="x" {...props} onClose={f}>x</Overlay>;').unread).toHaveLength(1);
    expect(dialogClasses('const W = (props) => <Float {...props} className="kb-ok" />;').unread).toHaveLength(1);
    expect(dialogClasses('const A = () => <Panel className="kb-not-a-dialog" />;').found.size).toBe(0);
  });

  /** What draws the frame: the cut, the border, the sheet it is drawn on, the glow. */
  const FRAME_PROPS = /^(--kb-cut|--kb-cut-in|--kb-border|clip-path|background|background-color|background-image|border(-[a-z-]+)?|outline|box-shadow|filter)$/u;
  const SHELL = ['engine/ui/glass/shell.css', 'engine/ui/glass/base.css'];

  const sheets = walk(path.join(root, 'engine'), '.css').concat(walk(path.join(root, 'instances'), '.css'));
  const rules = sheets.flatMap((f) => {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      file: rel(f),
      selectors: m[1]!.split(',').map((x) => x.replace(/\s+/g, ' ').trim()),
      props: m[2]!.split(';').map((d) => d.split(':')[0]!.trim()).filter(Boolean),
    }));
  });
  /** The compound a selector ends in, its pseudo-classes and attribute tests left off. */
  const last = (sel: string) => sel.split(/[ >+~]+/u).pop()!.replace(/\[[^\]]*\]|:[a-z-]+(\([^)]*\))?/gu, '');
  /**
   * A compound is a dialog's box when it names a class an Overlay or a Float is given, or names a frame class and nothing else. The frame
   * classes are also the chamfer shapes a few non-dialog pieces borrow (a post, an article, a podium); such a piece sets its own cut, border
   * and sheet in a compound like `.kb-glass-cut-dialog.kb-welcome-post`, and that is not a dialog drawing its own frame. This is sound, and not circular:
   * BOXES is read from the AST of every Overlay and Float className, and the `unread` test fails on any className it cannot read,
   * so a class outside BOXES is not a dialog by construction. The limit: a frame class plus a modifier added only in CSS or at runtime
   * (`.kb-glass-dialog.kb-some-state`) is not counted as a box.
   */
  const isBoxSel = (sel: string, boxes: string[], frames: string[]) => {
    if (/::/u.test(sel)) return false;
    const cs = last(sel).split('.').filter(Boolean);
    return cs.some((c) => boxes.includes(c) && !frames.includes(c)) || (cs.length > 0 && cs.every((c) => frames.includes(c)));
  };
  const isBox = (sel: string) => isBoxSel(sel, BOXES, FRAME_CLASSES);

  test('only the shell sets the dialogs\' cut, border, sheet and glow', () => {
    const own = rules.filter((r) => !SHELL.includes(r.file))
      .flatMap((r) => r.selectors.filter(isBox).flatMap((s) => r.props.filter((p) => FRAME_PROPS.test(p)).map((p) => `${r.file}: ${s} sets ${p}`)));
    expect(own).toEqual([]);
  });

  test('a planted dialog frame outside the shell is still caught, and a borrowed shape is not', () => {
    expect(isBox('.kb-glass-cut-dialog.kb-turn-dialog')).toBe(true);
    expect(isBox('.kb-glass-cut-dialog')).toBe(true);
    expect(isBox('.kb-glass-dialog:hover')).toBe(true);
    expect(isBox('.x .kb-glass-cut-dialog.kb-turn-dialog')).toBe(true);
    /* The stated limit: a modifier that no Overlay or Float names is not a dialog's class, so this compound is not counted. */
    expect(isBox('.kb-glass-dialog.kb-some-state')).toBe(false);
    expect(isBox('.kb-glass-cut-dialog.kb-welcome-post')).toBe(false);
    expect(isBox('.kb-glass-cut-dialog.kb-welcome-post::before')).toBe(false);
  });

  test('only the shell styles Close', () => {
    const own = rules.filter((r) => r.file !== 'engine/ui/glass/shell.css')
      .flatMap((r) => r.selectors.filter((s) => last(s).includes('kb-glass-dialog-close') || last(s).includes('kb-lens-close')).map((s) => `${r.file}: ${s}`));
    expect(own).toEqual([]);
  });
});
