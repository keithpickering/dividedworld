/**
 * The bright ink's mark on a post body (docs/plans/2026-11-08-brighter-effects-design.md, section 2): an effect that draws a bright
 * look asks for it with `markBrightInk`, and engine/ui/thread/thread.css reads the mark. Setting it twice leaves one, and a missing body is nothing.
 */
import { describe, expect, test } from 'vitest';
import { markBrightInk } from './body.ts';

describe('markBrightInk', () => {
  test('sets the mark, once, and removes it', () => {
    const body = document.createElement('div');
    markBrightInk(body, true);
    markBrightInk(body, true);
    expect(body.getAttribute('data-kb-bright-ink')).toBe('');
    markBrightInk(body, false);
    expect(body.hasAttribute('data-kb-bright-ink')).toBe(false);
    markBrightInk(body, false);
    expect(body.hasAttribute('data-kb-bright-ink')).toBe(false);
  });
  test('a post with no body is nothing to mark', () => {
    expect(() => { markBrightInk(null, true); markBrightInk(null, false); }).not.toThrow();
  });
});
