// @vitest-environment node
/**
 * The layout check's self-test: the judgment e2e/glass-layout.spec.ts makes of every screen
 * (e2e/glass-layout.ts), driven red on plain data by each defect it exists to catch. A Vitest file,
 * as e2e/glass-text.test.ts is, because the judgment needs no browser: the spec gathers the facts
 * in the page (e2e/glass-layout-page.ts) and hands them to `judgeLayout`. Each poison starts from
 * a fact set that passes and breaks one thing, so a check that has gone quiet cannot pass the case
 * that breaks it; the first case asserts the clean set passes, and the last that a correct one of
 * each refusal's subject is not refused.
 *
 * The five poisons are the five refusals: a squeezed block (the phone My characters head as found,
 * a lead of 0px by 547px), an overflow (a panel 20px past the right edge, and the same inside a
 * scrolling track, which passes), a mismatched row (Cancel 44px and 18px beside Reveal 48px and
 * 21px), a cut control (a button whose top-right corner lies in its panel's 24px chamfer), and a
 * calm outside its box (a backing 32px outside its element on every side, the calm before the
 * inward backing).
 */
import { describe, expect, test } from 'vitest';
import { judgeLayout, type LayoutFacts } from './glass-layout.ts';

const SCREEN = 'My characters, on a phone';

/** A phone screen that passes: a head, a row of two matching buttons, a button clear of its panel's cut, a calm inside its box. */
const clean: LayoutFacts = {
  screen: SCREEN,
  viewport: { width: 390, height: 844, scrollWidth: 390 },
  blocks: [
    { path: 'main:nth-child(1) > header:nth-child(1) > h1:nth-child(1)', rect: { x: 16, y: 20, width: 358, height: 40 }, fontSize: 32, longestWord: 120, wraps: false, textWidth: 120 },
    { path: 'main:nth-child(1) > header:nth-child(1) > p.kb-lead:nth-child(2)', rect: { x: 16, y: 70, width: 358, height: 60 }, fontSize: 21, longestWord: 60, wraps: true, textWidth: 330 },
  ],
  scrollers: [],
  extents: [],
  rows: [
    {
      path: 'main:nth-child(1) > div.kb-button-row:nth-child(3)', kind: 'button-row',
      controls: [
        { path: 'main:nth-child(1) > div.kb-button-row:nth-child(3) > button:nth-child(1)', rect: { x: 16, y: 140, width: 100, height: 48 }, fontSize: 21, glass: true },
        { path: 'main:nth-child(1) > div.kb-button-row:nth-child(3) > button:nth-child(2)', rect: { x: 124, y: 140, width: 100, height: 48 }, fontSize: 21, glass: true },
      ],
    },
  ],
  controls: [
    {
      path: 'main:nth-child(1) > section:nth-child(4) > button:nth-child(1)', rect: { x: 380, y: 210, width: 80, height: 40 },
      panel: { path: 'main:nth-child(1) > section:nth-child(4)', rect: { x: 100, y: 200, width: 400, height: 200 }, polygon: [[100, 200], [476, 200], [500, 224], [500, 400], [100, 400]] },
    },
  ],
  calms: [{ path: 'main:nth-child(1) > header:nth-child(1)', backing: { x: 16, y: 20, width: 358, height: 110 }, element: { x: 16, y: 20, width: 358, height: 110 } }],
};

const refusals = (change: Partial<LayoutFacts>) => judgeLayout({ ...clean, ...change });

describe('the layout judgment', () => {
  test('a screen that lays out correctly passes', () => {
    expect(judgeLayout(clean)).toEqual([]);
  });

  test('refuses a squeezed block: the lead of 0px by 547px', () => {
    const lead = { path: 'main:nth-child(1) > header:nth-child(1) > p.kb-lead:nth-child(2)', rect: { x: 16, y: 70, width: 0, height: 547 }, fontSize: 21, longestWord: 60, wraps: true, textWidth: 330 };
    const out = refusals({ blocks: [clean.blocks[0]!, lead] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('p.kb-lead');
    expect(out[0]).toContain(SCREEN);
    expect(out[0]).toContain('squeezed');
  });

  test('refuses a block narrower than its longest word, though not narrower than ten ems', () => {
    const out = refusals({ blocks: [{ path: 'main > p.word', rect: { x: 0, y: 0, width: 200, height: 30 }, fontSize: 10, longestWord: 260, wraps: true, textWidth: 260 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('p.word');
  });

  test('refuses a one-line block whose text is wider than its own box', () => {
    const out = refusals({ blocks: [{ path: 'main > span.kb-chip', rect: { x: 0, y: 0, width: 100, height: 20 }, fontSize: 10, longestWord: 40, wraps: false, textWidth: 180 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('span.kb-chip');
  });

  test('refuses a panel 20px past the right edge', () => {
    const out = refusals({ extents: [{ path: 'main:nth-child(1) > section.kb-panel:nth-child(5)', rect: { x: 16, y: 300, width: 394, height: 100 } }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('section.kb-panel');
    expect(out[0]).toContain(SCREEN);
    expect(out[0]).toContain('overflow');
  });

  test('refuses a page that scrolls sideways', () => {
    const out = refusals({ viewport: { width: 390, height: 844, scrollWidth: 410 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('overflow');
  });

  test('passes the same overflow inside a track that scrolls on purpose', () => {
    const track = 'main:nth-child(1) > ul.kb-track:nth-child(5)';
    expect(refusals({
      scrollers: [{ path: track, rect: { x: 0, y: 300, width: 390, height: 100 } }],
      extents: [{ path: `${track} > li:nth-child(3)`, rect: { x: 330, y: 300, width: 80, height: 100 } }],
    })).toEqual([]);
  });

  test('does not excuse the scrolling track itself reaching past the edge', () => {
    const track = 'main:nth-child(1) > ul.kb-track:nth-child(5)';
    const out = refusals({
      scrollers: [{ path: track, rect: { x: 0, y: 300, width: 410, height: 100 } }],
      extents: [{ path: track, rect: { x: 0, y: 300, width: 410, height: 100 } }],
    });
    expect(out).toHaveLength(1);
  });

  test('refuses a row whose buttons differ: Cancel 44px and 18px beside Reveal 48px and 21px', () => {
    const row = 'main:nth-child(1) > div.kb-button-row:nth-child(3)';
    const out = refusals({
      rows: [{
        path: row, kind: 'button-row',
        controls: [
          { path: `${row} > button:nth-child(1)`, rect: { x: 16, y: 140, width: 100, height: 44 }, fontSize: 18, glass: true },
          { path: `${row} > button:nth-child(2)`, rect: { x: 124, y: 140, width: 100, height: 48 }, fontSize: 21, glass: true },
        ],
      }],
    });
    expect(out).toHaveLength(2);
    expect(out.join('\n')).toContain('height');
    expect(out.join('\n')).toContain('type size');
    expect(out[0]).toContain(SCREEN);
  });

  test('refuses two adjacent controls of one flex line that differ, and tolerates a pixel of height', () => {
    const line = 'main > div.kb-actions';
    const pair = (h: number) => ({
      path: line, kind: 'flex-line' as const,
      controls: [
        { path: `${line} > button:nth-child(1)`, rect: { x: 0, y: 0, width: 90, height: 40 }, fontSize: 18, glass: false },
        { path: `${line} > a:nth-child(2)`, rect: { x: 96, y: 0, width: 90, height: h }, fontSize: 18, glass: false },
      ],
    });
    expect(refusals({ rows: [pair(40.9)] })).toEqual([]);
    expect(refusals({ rows: [pair(48)] })).toHaveLength(1);
  });

  test('refuses a button whose top-right corner lies in its panel\'s 24px chamfer', () => {
    const panel = clean.controls[0]!.panel!;
    const out = refusals({ controls: [{ path: 'main:nth-child(1) > section:nth-child(4) > button:nth-child(1)', rect: { x: 420, y: 200, width: 80, height: 40 }, panel }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('button');
    expect(out[0]).toContain(SCREEN);
    expect(out[0]).toContain('cut');
  });

  test('refuses a control 10px past a straight edge of its panel, which the clip cuts off', () => {
    const panel = clean.controls[0]!.panel!;
    const out = refusals({ controls: [{ path: 'main > section > button.over', rect: { x: 430, y: 300, width: 80, height: 40 }, panel }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('button.over');
    expect(out[0]).toContain('right');
  });

  test('refuses a control 30px outside its panel', () => {
    const panel = clean.controls[0]!.panel!;
    const out = refusals({ controls: [{ path: 'main > section > button.far', rect: { x: 530, y: 250, width: 80, height: 40 }, panel }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('button.far');
  });

  test('reads a control by the corners it is drawn at: a layout box clear of the chamfer, a skewed corner in it', () => {
    const panel = clean.controls[0]!.panel!;
    const rect = { x: 380, y: 210, width: 80, height: 40 };
    const quad = [[410, 200], [480, 200], [450, 240], [380, 240]] as const;
    const out = refusals({ controls: [{ path: 'main > section > button.drawn', rect, quad, panel }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('button.drawn');
    expect(refusals({ controls: [{ path: 'main > section > button.drawn', rect, panel }] })).toEqual([]);
  });

  test('refuses a skewed button whose drawn corner lies in the chamfer, though its bounding box corners need not', () => {
    const panel = clean.controls[0]!.panel!;
    /* Skewed by 10 degrees: the top-right corner is drawn 8px right of the box's middle edge; the quad's top-right (496,200) is in the cut. */
    const quad = [[420, 200], [496, 200], [492, 240], [416, 240]] as const;
    const out = refusals({ controls: [{ path: 'main > section > button.skewed', rect: { x: 416, y: 200, width: 80, height: 40 }, quad, panel }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('button.skewed');
    /* The same box with its drawn corners clear of the cut passes. */
    const clear = [[390, 210], [466, 210], [462, 250], [386, 250]] as const;
    expect(refusals({ controls: [{ path: 'main > section > button.skewed', rect: { x: 386, y: 210, width: 80, height: 40 }, quad: clear, panel }] })).toEqual([]);
  });

  test('refuses a calm whose backing lies 32px outside its element on every side', () => {
    const el = { x: 16, y: 20, width: 358, height: 110 };
    const out = refusals({ calms: [{ path: 'main:nth-child(1) > header:nth-child(1)', element: el, backing: { x: el.x - 32, y: el.y - 32, width: el.width + 64, height: el.height + 64 } }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('header');
    expect(out[0]).toContain('calm');
  });

  test('a calm inside its box, and a backing within a pixel of it, are not refused', () => {
    const el = { x: 16, y: 20, width: 358, height: 110 };
    expect(refusals({ calms: [{ path: 'header', element: el, backing: { x: 15.5, y: 20, width: 359, height: 110 } }] })).toEqual([]);
  });
});
