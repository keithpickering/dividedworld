/**
 * No dialog draws a frame of its own, in the engine or in an instance (engine/ui/glass/Frame.tsx; the glass polish plan, "Modals").
 * Read as text, over every component and stylesheet of both layers, so it lives here, in the composition root: the engine's
 * own test of the frame (engine/ui/glass/frame.test.tsx) may not read an instance's files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    /* The board's own 2003 modal (modal.tsx) and the tour's tip (Spotlight) are not glass dialogs; the other two are the frame's. */
    expect(own).toEqual(['engine/ui/glass/Float.tsx', 'engine/ui/glass/Overlay.tsx', 'engine/ui/modal.tsx', 'engine/ui/tips/Spotlight.tsx']);
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
  /** The classes that are a dialog's box: the frame's and each dialog's own. */
  const BOXES = ['kb-glass-dialog', 'kb-glass-cut-dialog', 'kb-picker', 'kb-lens', 'kb-hold-view', 'kb-play-dialog', 'kb-turn-dialog', 'kb-debut-dialog', 'kb-reveal-dialog', 'kb-vending-about-dialog', 'kb-queue-dialog', 'kb-move-overlay'];
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
  const isBox = (sel: string) => !/::/u.test(sel) && last(sel).split('.').filter(Boolean).some((c) => BOXES.includes(c));

  test('only the shell sets the dialogs\' cut, border, sheet and glow', () => {
    const own = rules.filter((r) => !SHELL.includes(r.file))
      .flatMap((r) => r.selectors.filter(isBox).flatMap((s) => r.props.filter((p) => FRAME_PROPS.test(p)).map((p) => `${r.file}: ${s} sets ${p}`)));
    expect(own).toEqual([]);
  });

  test('only the shell styles Close', () => {
    const own = rules.filter((r) => r.file !== 'engine/ui/glass/shell.css')
      .flatMap((r) => r.selectors.filter((s) => last(s).includes('kb-glass-dialog-close') || last(s).includes('kb-lens-close')).map((s) => `${r.file}: ${s}`));
    expect(own).toEqual([]);
  });
});
