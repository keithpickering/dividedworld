/**
 * One frame for every glass dialog (Frame.tsx; the glass polish plan, "Modals"). jsdom paints nothing, so what the frame is
 * is held two ways: the markup every dialog is rendered through (Overlay and Float, the two things that stand a dialog, each
 * through Frame.tsx's FRAME, DialogBar and CloseCross), and the stylesheets, read as text, which may not draw a frame of their
 * own: the chamfer's size and the border's width are set once (base.css, shell.css), and Close's look once (shell.css). The
 * computed result, on every real dialog, is e2e/glass-dialogs.spec.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { renderInWorld } from '../test-world.tsx';
import { Float } from './Float.tsx';
import { FRAME } from './Frame.tsx';
import { Overlay } from './Overlay.tsx';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

describe('the markup: every dialog stands in the one frame', () => {
  test('an overlay is the frame, with its bar and the one Close', () => {
    renderInWorld(<Overlay title="Anything" surface="turn" onClose={() => undefined}><p>Body</p></Overlay>);
    const box = screen.getByRole('dialog');
    for (const c of FRAME.split(' ')) expect(box).toHaveClass(c);
    const bar = box.querySelector('.kb-glass-dialog-bar');
    expect(bar).not.toBeNull();
    const close = bar!.querySelector('button.kb-glass-dialog-close');
    expect(close).not.toBeNull();
    expect(close!.querySelector('.kb-visually-hidden')).toHaveTextContent('Close');
    expect(close).not.toHaveAttribute('data-kb-look');
  });

  test('a float (the Lens) is the same frame', () => {
    const anchor = { current: document.body };
    renderInWorld(<Float label="Cards" surface="effect" anchor={anchor} sheet={false} onClose={() => undefined}><p>Body</p></Float>);
    const box = screen.getByRole('dialog');
    for (const c of FRAME.split(' ')) expect(box).toHaveClass(c);
  });

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

  test('the shell sets the cut once, to the fifth chamfer, and the border once, 1.5px', () => {
    const base = fs.readFileSync(path.join(root, 'engine/ui/glass/base.css'), 'utf8');
    expect(base).toMatch(/\.kb-glass-cut-dialog \{ --kb-cut: var\(--kb-glass-chamfer-5\); \}/u);
    expect(base).toMatch(/--kb-border: 1\.5px;/u);
  });
});
