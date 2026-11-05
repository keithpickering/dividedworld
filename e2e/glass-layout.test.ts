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
 * 21px), a cut control (a button whose top-right corner lies in its panel's 24px chamfer), and two
 * for the calm: a calm cut (a 32px feather past the right edge of a column that clips, the phone
 * Settings as found on main, where a 17px gutter cut it) and a calm over other content (a feather
 * lying on a heading that stands in no calm). Two calms whose feathers overlap are not refused.
 */
import { describe, expect, test } from 'vitest';
import { judgeLayout, type LayoutFacts } from './glass-layout.ts';

const SCREEN = 'My characters, on a phone';

/** A phone screen that passes: a head, a row of two matching buttons, a button clear of its panel's cut, a calm whose feather has room in the column that clips it. */
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
  calms: [{ path: 'main:nth-child(1) > header:nth-child(1)', backing: { x: 0, y: 4, width: 390, height: 142 }, element: { x: 16, y: 20, width: 358, height: 110 }, clips: [{ path: 'main:nth-child(1)', rect: { x: 0, y: 0, width: 390, height: 900 }, x: true, y: false }] }],
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

  /* The calm: a header at 16..374, its feather 16px (the phone's gutter) a side, in a column that clips sideways at 0..390. */
  const headerPath = 'main:nth-child(1) > header:nth-child(1)';
  const el = { x: 16, y: 20, width: 358, height: 110 };
  const column = { path: 'main:nth-child(1)', rect: { x: 17, y: 0, width: 356, height: 900 }, x: true, y: false };

  test('refuses a calm cut: a 32px feather past the right edge of the column that clips it', () => {
    const out = refusals({ calms: [{ path: headerPath, element: { ...el, x: 17, width: 356 }, backing: { x: -15, y: -12, width: 420, height: 174 }, clips: [column] }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('calm cut');
    expect(out[0]).toContain('header');
    expect(out[0]).toContain('main');
    expect(out[0]).toContain('right');
    expect(out[0]).toContain(SCREEN);
  });

  test('does not call a calm cut by an axis its ancestor does not clip, nor by a scroller its element is scrolled out of', () => {
    const backing = { x: -15, y: -12, width: 420, height: 174 };
    expect(refusals({ calms: [{ path: headerPath, element: { ...el, x: 17, width: 356 }, backing, clips: [{ ...column, rect: { ...column.rect, y: -100 }, x: false, y: true }] }] })).toEqual([]);
    /* A calm in a track, wholly past the track's box, is not drawn there at all. */
    expect(refusals({ calms: [{ path: headerPath, element: { x: 500, y: 20, width: 100, height: 40 }, backing: { x: 468, y: -12, width: 164, height: 104 }, clips: [{ path: 'main > ul', rect: { x: 0, y: 0, width: 390, height: 900 }, x: true, y: false }] }] })).toEqual([]);
  });

  test('a calm whose feather lies inside the column that clips it is not refused, nor one with no clipping ancestor', () => {
    expect(refusals({ calms: [{ path: headerPath, element: el, backing: { x: 0, y: 4, width: 390, height: 142 }, clips: [{ ...column, rect: { x: 0, y: 0, width: 390, height: 900 } }] }] })).toEqual([]);
    expect(refusals({ calms: [{ path: headerPath, element: el, backing: { x: -16, y: 4, width: 422, height: 142 }, clips: [] }] })).toEqual([]);
  });

  test('an unframed class is no panel: a calm cut by the row that holds it is refused, and so is one over a heading beside it', () => {
    /* The roster's rail has no clip-path and no ground (characters.css), so a calm under it is judged as one in the page: the row that scrolls clips its feather. */
    const rail = 'main:nth-child(1) > div.kb-class-rail:nth-child(2)';
    const grid = { path: `${rail} > div.kb-class-grid:nth-child(1)`, rect: { x: 0, y: 200, width: 390, height: 300 }, x: true, y: true };
    const tabs = { path: `${grid.path} > div.kb-carousel-tablist.kb-calm:nth-child(1)`, element: { x: 0, y: 232, width: 390, height: 236 }, backing: { x: -32, y: 200, width: 454, height: 300 }, clips: [grid] };
    const cut = refusals({ calms: [tabs] });
    expect(cut.some((o) => o.includes('calm cut') && o.includes('div.kb-class-grid'))).toBe(true);
    /* A framed panel (a class that names one) stays excused, so the exemption is the panel's and not the geometry's. */
    const framed = 'main:nth-child(1) > div.kb-hud:nth-child(2)';
    const inHud = { ...tabs, path: `${framed} > div.kb-carousel-tablist.kb-calm:nth-child(1)`, clips: [{ ...grid, path: `${framed} > div.kb-class-grid:nth-child(1)` }] };
    expect(refusals({ calms: [inHud] })).toEqual([]);
    /* And a heading the rail's calm lies on, beside it in the page, is refused as over other content. */
    const head = { path: 'main:nth-child(1) > h2:nth-child(1)', rect: { x: 16, y: 190, width: 200, height: 30 }, fontSize: 30, longestWord: 100, wraps: false, textWidth: 150, column: 358 };
    const over = refusals({ blocks: [...clean.blocks, head], calms: [{ ...tabs, clips: [] }] });
    expect(over.some((o) => o.includes('calm over other content') && o.includes('h2'))).toBe(true);
  });

  /* A heading that stands in no calm, 20px under the header's foot, inside the header's 16px feather. */
  const heading = { path: 'main:nth-child(1) > h2:nth-child(2)', rect: { x: 16, y: 138, width: 200, height: 30 }, fontSize: 30, longestWord: 100, wraps: false, textWidth: 150, column: 358 };
  const calmed = { path: headerPath, element: el, backing: { x: 0, y: 4, width: 390, height: 142 }, clips: [] };

  test('refuses a calm over other content: its feather lies on a heading that stands in no calm', () => {
    const out = refusals({ blocks: [...clean.blocks, heading], calms: [calmed] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('calm over other content');
    expect(out[0]).toContain('header');
    expect(out[0]).toContain('h2');
    expect(out[0]).toContain(SCREEN);
  });

  test('refuses a calm over a control that stands in no calm', () => {
    const control = { path: 'main:nth-child(1) > button:nth-child(2)', rect: { x: 16, y: 140, width: 100, height: 48 }, panel: null };
    const out = refusals({ controls: [...clean.controls, control], calms: [calmed] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('calm over other content');
    expect(out[0]).toContain('button');
  });

  test('a heading clear of the feather, one inside this calm and one in another calm are not refused', () => {
    expect(refusals({ blocks: [...clean.blocks, { ...heading, rect: { ...heading.rect, y: 150 } }], calms: [calmed] })).toEqual([]);
    expect(refusals({ blocks: [...clean.blocks, { ...heading, path: `${headerPath} > h2:nth-child(3)`, rect: { ...heading.rect, y: 100 } }], calms: [calmed] })).toEqual([]);
    const other = { path: 'main:nth-child(1) > section:nth-child(2)', element: { x: 16, y: 150, width: 300, height: 60 }, backing: { x: 0, y: 134, width: 332, height: 92 }, clips: [] };
    expect(refusals({ blocks: [...clean.blocks, { ...heading, path: `${other.path} > h2:nth-child(1)` }], calms: [calmed, other] })).toEqual([]);
  });

  test('a calm in a framed panel is refused over uncalmed content in the same panel, and excused over content outside it', () => {
    const hudHeader = { ...calmed, path: 'div.kb-hud:nth-child(1) > header:nth-child(1)' };
    const inside = { ...heading, path: 'div.kb-hud:nth-child(1) > h2:nth-child(2)' };
    const out = refusals({ blocks: [...clean.blocks, inside], calms: [hudHeader] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('calm over other content');
    /* The panel covers what lies outside it, so a heading of the page under the panel is not what the calm lies on. */
    expect(refusals({ blocks: [...clean.blocks, heading], calms: [hudHeader] })).toEqual([]);
    /* In another calm of the same panel it is a staggered backing. */
    const sibling = { path: 'div.kb-hud:nth-child(1) > section:nth-child(2)', element: { x: 16, y: 150, width: 300, height: 60 }, backing: { x: 0, y: 134, width: 332, height: 92 }, clips: [] };
    expect(refusals({ blocks: [...clean.blocks, { ...inside, path: `${sibling.path} > h2:nth-child(1)` }], calms: [hudHeader, sibling] })).toEqual([]);
  });

  test('a calm lies under content that paints above its backing: it dims nothing, so it is not refused; painted over it, it is', () => {
    /* The faded avatar: the swap's calm painted its 85% ground over the avatar in its feather. The gatherer reads the paint order, and lists what is above. */
    const control = { path: 'main:nth-child(1) > button:nth-child(2)', rect: { x: 16, y: 140, width: 100, height: 48 }, panel: null };
    const poison = refusals({ controls: [...clean.controls, control], calms: [{ ...calmed, above: [] }] });
    expect(poison).toHaveLength(1);
    expect(poison[0]).toContain('calm over other content');
    expect(poison[0]).toContain('button');
    /* The same geometry with the control above the backing passes, for a control and for a block. */
    expect(refusals({ controls: [...clean.controls, control], calms: [{ ...calmed, above: [control.path] }] })).toEqual([]);
    expect(refusals({ blocks: [...clean.blocks, heading], calms: [{ ...calmed, above: [heading.path] }] })).toEqual([]);
    /* Another element being above is no excuse for this one. */
    expect(refusals({ blocks: [...clean.blocks, heading], calms: [{ ...calmed, above: [control.path] }] })).toHaveLength(1);
  });

  test('a heading with something drawn over all of it is not what the calm lies on', () => {
    expect(refusals({ blocks: [...clean.blocks, { ...heading, seen: null }], calms: [calmed] })).toEqual([]);
  });

  test('a heading under the part of the feather a clipping ancestor hides is not what the calm lies on', () => {
    /* The column ends at y 140, so the feather below it is not drawn; the heading at 138 to 168 still meets the drawn part, the one at 145 does not. */
    const clip = { path: 'main:nth-child(1)', rect: { x: 0, y: 0, width: 390, height: 140 }, x: false, y: true };
    const over = (blocks: LayoutFacts['blocks']) => refusals({ blocks, calms: [{ ...calmed, clips: [clip] }] }).filter((r) => r.startsWith('calm over'));
    expect(over([...clean.blocks, heading])).toHaveLength(1);
    expect(over([...clean.blocks, { ...heading, rect: { ...heading.rect, y: 145 } }])).toEqual([]);
  });

  test('a heading half covered is judged by the half that is seen', () => {
    /* The heading spans y 138 to 168; the lower half, from 153, is drawn over by something else, and the feather ends at 146. */
    expect(refusals({ blocks: [...clean.blocks, { ...heading, seen: { x: 16, y: 138, width: 200, height: 8 } }], calms: [calmed] })).toHaveLength(1);
    expect(refusals({ blocks: [...clean.blocks, { ...heading, seen: { x: 16, y: 150, width: 200, height: 18 } }], calms: [calmed] })).toEqual([]);
  });

  test('a calm with another layer drawn over it (a dialog over the HUD) is under that content, not over it', () => {
    expect(refusals({ blocks: [...clean.blocks, heading], calms: [{ ...calmed, seen: null }] })).toEqual([]);
    /* Seen only down to y 100, above the heading, which is at 138. */
    expect(refusals({ blocks: [...clean.blocks, heading], calms: [{ ...calmed, seen: { x: 0, y: 4, width: 390, height: 96 } }] })).toEqual([]);
    expect(refusals({ blocks: [...clean.blocks, heading], calms: [{ ...calmed, seen: { x: 0, y: 4, width: 390, height: 142 } }] })).toHaveLength(1);
  });

  test('two calms whose feathers overlap are not refused: a staggered backing', () => {
    const other = { path: 'main:nth-child(1) > section:nth-child(2)', element: { x: 16, y: 140, width: 300, height: 60 }, backing: { x: 0, y: 124, width: 332, height: 92 }, clips: [] };
    const para = { path: `${other.path} > p:nth-child(1)`, rect: { x: 16, y: 140, width: 300, height: 60 }, fontSize: 21, longestWord: 60, wraps: true, textWidth: 290, column: 358 };
    expect(refusals({ blocks: [...clean.blocks, para], calms: [calmed, other] })).toEqual([]);
  });

  /* A calm in a framed panel (the HUD's glass, here) and a heading beside it in the same panel, inside its feather. */
  const hudCalm = { path: 'main:nth-child(1) > section.kb-hud:nth-child(2) > div.kb-hud-bar:nth-child(1) > div.kb-hud-aura.kb-calm:nth-child(2)', element: el, backing: { x: 0, y: 4, width: 390, height: 142 }, clips: [] };
  const hudHeading = { ...heading, path: 'main:nth-child(1) > section.kb-hud:nth-child(2) > div.kb-hud-bar:nth-child(1) > span.kb-hud-name:nth-child(1)' };
  const aboveHud = { ...heading, path: 'main:nth-child(1) > h2:nth-child(3)' };

  test('a calm in a framed panel is not refused for lying on the page\'s content the panel covers, only on its own', () => {
    expect(refusals({ blocks: [aboveHud], calms: [hudCalm] })).toEqual([]);
    expect(refusals({ blocks: [hudHeading], calms: [hudCalm] })).toHaveLength(1);
    /* The poison: the same geometry outside a framed panel is refused, so the exemption is the panel's and not the geometry's. */
    expect(refusals({ blocks: [heading], calms: [{ ...hudCalm, path: calmed.path }] })).toHaveLength(1);
    /* A class that only starts with a panel's name is not a panel. */
    expect(refusals({ blocks: [heading], calms: [{ ...hudCalm, path: 'main:nth-child(1) > section.kb-hud-extra:nth-child(2) > p.kb-calm:nth-child(1)' }] })).toHaveLength(1);
  });

  test('a calm cut by the framed panel it stands in, or by a clipper inside it, is not refused; one cut by a clipper outside it still is', () => {
    const hudClip = { path: 'main:nth-child(1) > section.kb-hud:nth-child(2) > div.kb-hud-glass:nth-child(1)', rect: { x: 16, y: 0, width: 358, height: 900 }, x: true, y: false };
    const calm = { ...hudCalm, element: { x: 16, y: 20, width: 358, height: 110 }, backing: { x: -16, y: 4, width: 422, height: 142 } };
    expect(refusals({ calms: [{ ...calm, clips: [hudClip] }] })).toEqual([]);
    const outside = { ...hudClip, path: 'main:nth-child(1)' };
    expect(refusals({ calms: [{ ...calm, clips: [outside] }] }).filter((r) => r.startsWith('calm cut'))).toHaveLength(1);
    /* The overlay a dialog stands in is not "outside": the dialog taller than the window is cut there. */
    const dlg = { ...calm, path: 'body > div.kb-glass.kb-glass-overlay:nth-child(1) > div.kb-glass-dialog:nth-child(1) > h2:nth-child(1) > span.kb-calm' };
    const overlay = { path: 'body > div.kb-glass.kb-glass-overlay:nth-child(1)', rect: { x: 16, y: 0, width: 358, height: 900 }, x: true, y: false };
    expect(refusals({ calms: [{ ...dlg, clips: [overlay] }] })).toEqual([]);
    expect(refusals({ calms: [{ ...dlg, path: dlg.path.replace('kb-glass-dialog', 'kb-card'), clips: [overlay] }] }).filter((r) => r.startsWith('calm cut'))).toHaveLength(1);
  });
});
