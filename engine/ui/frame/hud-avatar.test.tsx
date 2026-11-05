/**
 * The phone HUD's avatar is drawn at full strength. Its neighbors' calms are stacking contexts of their own (`isolation`, calm.css) and
 * a stacking context paints above a static sibling, so the swap's backing and its feather, reaching 32px past the swap, lay a 85% ground
 * over the avatar: it looked faded (it was the page's ground over it, not an opacity or a filter). The avatar is above them.
 */
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = fs.readFileSync('engine/ui/frame/frame.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const decls = (selector: string): string => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(',').map((s) => s.replace(/\s+/g, ' ').trim()).includes(selector)).map((m) => m[2]).join(';');
const PHONE = ":where(:root[data-kb-layout='phone'])";

describe('the phone HUD\'s avatar', () => {
  test('is above the calms beside it, so none of their ground lies over it', () => {
    const d = decls(`${PHONE} .kb-hud-plate--cast .kb-hud-avatar`);
    expect(d).toMatch(/position:\s*relative/);
    expect(d).toMatch(/z-index:\s*1\b/);
  });
  test('has no opacity or filter of its own', () => {
    expect(decls('.kb-hud-avatar')).not.toMatch(/opacity|filter/);
    expect(decls(`${PHONE} .kb-hud-avatar`)).not.toMatch(/opacity|filter/);
  });
  test('its desk-layout offsets do not move it off its cell', () => {
    const d = decls(`${PHONE} .kb-hud-plate--cast .kb-hud-avatar`);
    expect(d).toMatch(/left:\s*auto/);
    expect(d).toMatch(/top:\s*auto/);
  });
});
