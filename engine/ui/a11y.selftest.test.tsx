/**
 * The check is not known to work until it has been red. These run the very functions the real
 * tests run (a11y.ts's axeViolations, contrast.ts's contrastFailures) on poisoned input and
 * expect them to find the defect.
 */
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { axeViolations } from './a11y.ts';
import { contrastFailures } from './contrast.ts';

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

  test('low-contrast text, in the contrast path the real test uses (the token pairs)', () => {
    const poisoned = `
      :root { --kb-fg:#000; --kb-bg:#fff; --kb-muted:#bbb; --kb-link:#000; --kb-link-visited:#333; --kb-rule:#000; --kb-focus:#000;
        --kb-selection-fg:#fff; --kb-selection-bg:#000; --kb-hud-bg:#fff; --kb-chip-bg:#fff; --kb-chip-own:#000; --kb-pip:#000; }
      :root[data-kb-mode="dark"] { --kb-bg:#000; --kb-fg:#fff; --kb-muted:#333; --kb-hud-bg:#000; --kb-chip-bg:#000; --kb-chip-own:#fff; --kb-link:#fff; --kb-link-visited:#ccc; --kb-rule:#fff; --kb-focus:#fff; --kb-pip:#fff; --kb-selection-fg:#000; --kb-selection-bg:#fff; }`;
    const failures = contrastFailures(poisoned);
    expect(failures.some((f) => f.startsWith('light: muted text'))).toBe(true);
    expect(failures.some((f) => f.startsWith('dark: muted text'))).toBe(true);
  });
});
