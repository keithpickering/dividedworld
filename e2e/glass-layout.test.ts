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
 * 21px), a cut control (a button whose top-right corner lies in its panel's 24px chamfer), and the
 * calm's: a text node on the glass of a calmAll surface outside every calm region's box (a
 * paragraph placed beside its page's column region, not inside it). A calm that is a rect in the
 * smoke can be neither cut by a column's clip nor painted over content, so those two refusals the
 * text-element calm needed are gone with it.
 */
import { describe, expect, test } from 'vitest';
import { judgeLayout, type LayoutFacts } from './glass-layout.ts';

const SCREEN = 'My characters, on a phone';

/** A phone screen that passes: a head, a row of two matching buttons, a button clear of its panel's cut, and a column that is one calm region on a surface that is calmAll. */
const clean: LayoutFacts = {
  screen: SCREEN,
  viewport: { width: 390, height: 844, scrollWidth: 390 },
  blocks: [
    { path: 'main:nth-child(1) > header:nth-child(1) > h1:nth-child(1)', rect: { x: 16, y: 20, width: 358, height: 40 }, fontSize: 32, longestWord: 120, wraps: false, textWidth: 120, column: 358 },
    { path: 'main:nth-child(1) > header:nth-child(1) > p.kb-lead:nth-child(2)', rect: { x: 16, y: 70, width: 358, height: 60 }, fontSize: 21, longestWord: 60, wraps: true, textWidth: 330, column: 358 },
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
  regions: [{ path: 'main:nth-child(1) > div.kb-col:nth-child(2)', rect: { x: 16, y: 20, width: 358, height: 500 } }],
  calmAll: ['characters'],
};

const refusals = (change: Partial<LayoutFacts>) => judgeLayout({ ...clean, ...change });

describe('the layout judgment', () => {
  test('a screen that lays out correctly passes', () => {
    expect(judgeLayout(clean)).toEqual([]);
  });

  test('refuses a squeezed block: the lead of 0px by 547px', () => {
    const lead = { path: 'main:nth-child(1) > header:nth-child(1) > p.kb-lead:nth-child(2)', rect: { x: 16, y: 70, width: 0, height: 547 }, fontSize: 21, longestWord: 60, wraps: true, textWidth: 330, column: 358 };
    const out = refusals({ blocks: [clean.blocks[0]!, lead] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('p.kb-lead');
    expect(out[0]).toContain(SCREEN);
    expect(out[0]).toContain('squeezed');
  });

  test('a narrow block that fills its column is not squeezed, and one a sibling squeezed is', () => {
    const narrow = { path: 'main > aside.kb-side > p.kb-note', rect: { x: 16, y: 200, width: 120, height: 200 }, fontSize: 16, longestWord: 60, wraps: true, textWidth: 118, column: 120 };
    /* A 120px column holds a 120px paragraph at 16px type (under ten ems): the column gave it all it had. */
    expect(refusals({ blocks: [...clean.blocks, narrow] })).toEqual([]);
    /* The poison: the same paragraph in a 358px column, 238px of which a sibling took. */
    const out = refusals({ blocks: [...clean.blocks, { ...narrow, column: 358 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('p.kb-note');
    expect(out[0]).toContain('squeezed');
    expect(out[0]).toContain('358');
    /* An em or so short of the column is the control's own marker or edge (a radio beside its label), not a sibling's squeeze. */
    expect(refusals({ blocks: [...clean.blocks, { ...narrow, rect: { ...narrow.rect, width: 100 }, textWidth: 98, column: 120 }] })).toEqual([]);
    /* The boundary is 1.5 ems at 16px type (24px): 1.4 ems short (22.4px) passes, 1.6 ems short (25.6px) is refused. */
    expect(refusals({ blocks: [...clean.blocks, { ...narrow, rect: { ...narrow.rect, width: 120 - 1.4 * 16 }, textWidth: 90, column: 120 }] })).toEqual([]);
    const shortBy = refusals({ blocks: [...clean.blocks, { ...narrow, rect: { ...narrow.rect, width: 120 - 1.6 * 16 }, textWidth: 90, column: 120 }] });
    expect(shortBy).toHaveLength(1);
    expect(shortBy[0]).toContain('squeezed');
    /* A pixel short of the column is the column's own rounding. */
    expect(refusals({ blocks: [...clean.blocks, { ...narrow, column: 120.6 }] })).toEqual([]);
  });

  test('card-face art is exempt from the squeeze, and the same words off a card face are not', () => {
    const line = { path: 'main > div.kb-hand > button.kb-postcard > span.kb-postcard-line', rect: { x: 16, y: 200, width: 80, height: 60 }, fontSize: 14, longestWord: 40, wraps: true, textWidth: 78, column: 200 };
    expect(refusals({ blocks: [...clean.blocks, { ...line, art: true }] })).toEqual([]);
    const out = refusals({ blocks: [...clean.blocks, line] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('kb-postcard-line');
  });

  test('a lone control may wrap its label inside itself; a label split across controls on one line is refused', () => {
    const row = 'main:nth-child(1) > div.kb-button-row:nth-child(3)';
    const label = (n: number) => ({ path: `${row} > button:nth-child(${n}) > span.kb-glass-upright:nth-child(1)`, rect: { x: 40, y: 150, width: 90, height: 42 }, fontSize: 21, longestWord: 80, wraps: true, textWidth: 88, column: 90 });
    const btn = (n: number, y: number, h = 62) => ({ path: `${row} > button:nth-child(${n})`, rect: { x: 16, y, width: 358, height: h }, fontSize: 21, glass: true });
    /* One control on its line (the second is under it) wraps its label: passes. */
    expect(refusals({ blocks: [...clean.blocks, label(1)], rows: [{ path: row, kind: 'button-row', controls: [btn(1, 140), btn(2, 210)] }] })).toEqual([]);
    /* The poison: the second control shares the line. */
    const out = refusals({ blocks: [...clean.blocks, label(1)], rows: [{ path: row, kind: 'button-row', controls: [btn(1, 140), { ...btn(2, 140), rect: { x: 200, y: 140, width: 100, height: 62 } }] }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('split label');
    expect(out[0]).toContain('button');
    expect(out[0]).toContain(SCREEN);
    /* A one-line label that is wider than its control is still refused, wrapped or not allowed. */
    const wide = { ...label(1), wraps: false, textWidth: 130 };
    expect(refusals({ blocks: [...clean.blocks, wide], rows: [{ path: row, kind: 'button-row', controls: [btn(1, 140), btn(2, 210)] }] })).toHaveLength(1);
  });

  test('refuses a block narrower than its longest word, though not narrower than ten ems', () => {
    const out = refusals({ blocks: [{ path: 'main > p.word', rect: { x: 0, y: 600, width: 200, height: 30 }, fontSize: 10, longestWord: 260, wraps: true, textWidth: 260, column: 358 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('p.word');
  });

  test('refuses a one-line block whose text is wider than its own box', () => {
    const out = refusals({ blocks: [{ path: 'main > span.kb-chip', rect: { x: 0, y: 600, width: 100, height: 20 }, fontSize: 10, longestWord: 40, wraps: false, textWidth: 180, column: 358 }] });
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

  test('a button alone on its line may be taller than its row-mate for a wrapped label; on one line it may not', () => {
    const row = 'main > div.kb-button-row';
    const pair = (y: number) => ({
      path: row, kind: 'button-row' as const,
      controls: [
        { path: `${row} > button:nth-child(1)`, rect: { x: 16, y: 140, width: 358, height: 60 }, fontSize: 21, glass: true },
        { path: `${row} > button:nth-child(2)`, rect: { x: y === 140 ? 200 : 16, y, width: 100, height: 40 }, fontSize: 21, glass: true },
      ],
    });
    expect(refusals({ rows: [pair(208)] })).toEqual([]);
    expect(refusals({ rows: [pair(140)] })).toHaveLength(1);
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

  test('a form\'s board primary stands larger than the small buttons beside it, and those are still held to each other across it', () => {
    /* A synthetic row, checker input and not the composer (which no longer has a Reveal…): the reply box's foot as board 05-reply draws it (the board look design, section 3): Preview and Reveal… small, Send the form's one primary, larger. */
    const foot = 'form.kb-composer > div.kb-editor > div.kb-editor-foot';
    const line = (revealHeight: number, revealSize: number) => ({
      path: foot, kind: 'flex-line' as const,
      controls: [
        { path: `${foot} > button.kb-button:nth-child(4)`, rect: { x: 0, y: 0, width: 70, height: 24 }, fontSize: 12.5, glass: false },
        { path: `${foot} > button.kb-button:nth-child(5)`, rect: { x: 76, y: 0, width: 70, height: 28.1 }, fontSize: 13.8, glass: false, primary: true },
        { path: `${foot} > button.kb-button.kb-composer-reveal:nth-child(6)`, rect: { x: 152, y: 0, width: 70, height: revealHeight }, fontSize: revealSize, glass: false },
      ],
    });
    expect(refusals({ rows: [line(24, 12.5)] })).toEqual([]);
    /* Reveal… drawn at Send's size beside a small Preview is the mismatch the row check exists for, the primary between them or not. */
    expect(refusals({ rows: [line(28.1, 13.8)] }).map((r) => r.split(':')[0])).toEqual(['mismatched row', 'mismatched row']);
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

  /* The calm: a page's column is one region, the head above it another; the paragraph below stands in neither when it is placed beside them. */
  const column = { path: 'main:nth-child(1) > div.kb-col:nth-child(2)', rect: { x: 16, y: 20, width: 358, height: 500 } };
  const paragraph = { path: 'main:nth-child(1) > div.kb-col:nth-child(2) > p:nth-child(1)', rect: { x: 16, y: 200, width: 358, height: 60 }, fontSize: 21, longestWord: 60, wraps: true, textWidth: 330, column: 358, surface: 'characters' };

  test('a paragraph in its page\'s column region is not refused, on a surface that is calmAll', () => {
    expect(refusals({ blocks: [...clean.blocks, paragraph] })).toEqual([]);
  });

  test('refuses a text node on the glass outside every region\'s box, on a calmAll surface: a paragraph beside its page\'s column, not inside it', () => {
    const beside = { ...paragraph, path: 'main:nth-child(1) > p.kb-beside:nth-child(3)', rect: { x: 16, y: 560, width: 358, height: 60 } };
    const out = refusals({ blocks: [...clean.blocks, beside] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('text outside the calm');
    expect(out[0]).toContain('p.kb-beside');
    expect(out[0]).toContain(SCREEN);
    expect(out[0]).toContain('characters');
  });

  test('a paragraph that sticks out of the region by more than a pixel is outside it; one within a pixel is not', () => {
    const sticks = { ...paragraph, rect: { x: 16, y: 480, width: 358, height: 60 } };
    expect(refusals({ blocks: [...clean.blocks, sticks] })).toHaveLength(1);
    expect(refusals({ blocks: [...clean.blocks, { ...paragraph, rect: { x: 16, y: 460.5, width: 358, height: 60 } }] })).toEqual([]);
  });

  test('a paragraph outside every region is not refused on a surface that is not calmAll, nor when it is not on the glass', () => {
    const beside = { ...paragraph, path: 'main:nth-child(1) > p.kb-beside:nth-child(3)', rect: { x: 16, y: 560, width: 358, height: 60 } };
    expect(refusals({ blocks: [...clean.blocks, { ...beside, surface: 'rankings' }] })).toEqual([]);
    const { surface: _surface, ...board } = beside;
    expect(refusals({ blocks: [...clean.blocks, board] })).toEqual([]);
  });

  test('a paragraph in either of two regions is inside one', () => {
    const aside = { path: 'main:nth-child(1) > aside:nth-child(3)', rect: { x: 16, y: 540, width: 358, height: 200 } };
    const beside = { ...paragraph, path: 'main:nth-child(1) > aside:nth-child(3) > p:nth-child(1)', rect: { x: 16, y: 560, width: 358, height: 60 } };
    expect(refusals({ blocks: [...clean.blocks, beside] })).toHaveLength(1);
    expect(refusals({ blocks: [...clean.blocks, beside], regions: [...clean.regions, aside] })).toEqual([]);
  });
});
