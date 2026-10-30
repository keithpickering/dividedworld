/**
 * The check is not known to work until it has been red. These run the very functions the real
 * tests run (a11y.ts's axeViolations, contrast.ts's contrastFailures) on poisoned input and
 * expect them to find the defect.
 */
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { axeViolations } from './a11y.ts';
import { contrastFailures, darkBlocksDisagree } from './contrast.ts';

describe('the accessibility check detects', () => {
  test('an unlabeled button', async () => {
    const { container } = render(<main><h1>Poisoned</h1><button type="button"><svg aria-hidden="true" width="10" height="10" /></button></main>);
    const ids = (await axeViolations(container)).map((v) => v.id);
    expect(ids).toContain('button-name');
  });

  test('an image with no alternative text and a form field with no label', async () => {
    const { container } = render(<main><h1>Poisoned</h1><img src="x.png" /><input type="text" /></main>);
    const ids = (await axeViolations(container)).map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['image-alt', 'label']));
  });

  test('a clean story passes the same function', async () => {
    const { container } = render(<main><h1>Fine</h1><button type="button">Send</button></main>);
    expect(await axeViolations(container)).toEqual([]);
  });

  const BASE = `
    :root { --kb-fg:#000; --kb-bg:#fff; --kb-muted:#555; --kb-link:#000; --kb-link-visited:#333; --kb-rule:#000; --kb-focus:#000;
      --kb-selection-fg:#fff; --kb-selection-bg:#000; --kb-hud-bg:#fff; --kb-chip-bg:#fff; --kb-chip-own:#000; --kb-pip:#000; }`;
  const DARK = `--kb-bg:#000; --kb-fg:#fff; --kb-muted:#aaa; --kb-hud-bg:#000; --kb-chip-bg:#000; --kb-chip-own:#fff; --kb-link:#fff; --kb-link-visited:#ccc; --kb-rule:#fff; --kb-focus:#fff; --kb-pip:#fff; --kb-selection-fg:#000; --kb-selection-bg:#fff;`;
  const both = (dark: string, device = dark) => `${BASE}
    @media (prefers-color-scheme: dark) { :root:not([data-kb-mode="light"]) { ${device} } }
    :root[data-kb-mode="dark"] { ${dark} }`;

  test('the unpoisoned tokens pass the same function', () => {
    expect(contrastFailures(both(DARK))).toEqual([]);
  });

  test('low-contrast text, in the contrast path the real test uses (the token pairs), light and dark', () => {
    const failures = contrastFailures(BASE.replace('--kb-muted:#555', '--kb-muted:#bbb') + `:root[data-kb-mode="dark"] { ${DARK.replace('--kb-muted:#aaa', '--kb-muted:#333')} }`);
    expect(failures.some((f) => f.startsWith('light: muted text'))).toBe(true);
    expect(failures.some((f) => f.startsWith('dark: muted text'))).toBe(true);
  });

  test('a poor value only on the device-dark path', () => {
    const failures = contrastFailures(both(DARK, DARK.replace('--kb-muted:#aaa', '--kb-muted:#333')));
    expect(failures.some((f) => f.startsWith('dark (device): muted text'))).toBe(true);
    expect(darkBlocksDisagree(both(DARK, DARK.replace('--kb-muted:#aaa', '--kb-muted:#333'))).length).toBeGreaterThan(0);
  });

  test('a later block in the same selector form wins, as in the browser, in light, chosen dark and device dark', () => {
    const later = `${both(DARK)}
      :root { --kb-fg:#fefefe; }
      @media (prefers-color-scheme: dark) { :root:not([data-kb-mode="light"]) { --kb-fg:#000001; } }
      :root[data-kb-mode="dark"] { --kb-fg:#000001; }`;
    const failures = contrastFailures(later);
    expect(failures.some((f) => f.startsWith('light: body text'))).toBe(true);
    expect(failures.some((f) => f.startsWith('dark: body text'))).toBe(true);
    expect(failures.some((f) => f.startsWith('dark (device): body text'))).toBe(true);
  });

  test('a block written without spaces is the same block', () => {
    const failures = contrastFailures(`${both(DARK)}:root{--kb-fg:#fefefe}`);
    expect(failures.some((f) => f.startsWith('light: body text'))).toBe(true);
  });

  test('a player who chose light gets the light-mode block over :root', () => {
    const failures = contrastFailures(`${both(DARK)}:root[data-kb-mode="light"] { --kb-muted:#ddd; }`);
    expect(failures.some((f) => f.startsWith('light (chosen): muted text'))).toBe(true);
    expect(failures.some((f) => f.startsWith('light: muted text'))).toBe(false);
  });

  test('a token that is renamed away fails instead of being skipped', () => {
    const failures = contrastFailures(BASE.replace('--kb-hud-bg:#fff;', ''));
    expect(failures.some((f) => f.includes('--kb-hud-bg, which no stylesheet sets'))).toBe(true);
  });
});
