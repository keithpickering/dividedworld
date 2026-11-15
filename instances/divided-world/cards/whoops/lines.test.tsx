/**
 * What Whoops! reads out as the lines of a post (`readLines`): the post's own words, and nothing a note drawn on the post says.
 * A note's hidden line, a drawn note outside the body's words and a receipt are all marked `data-dw-aside`, and none of them is
 * a line of the post. jsdom lays nothing out, so a stand-in puts each text node on a line of its own, in document order.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readLines } from './lines.ts';

const LINE = 20;
const BOX = { w: 300, h: 200 };

beforeEach(() => {
  (Range.prototype as unknown as { getClientRects: () => unknown[] }).getClientRects = function (this: Range) {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let row = 0;
    for (let n = walk.nextNode(); n; n = walk.nextNode(), row++) if (n === this.startContainer) break;
    return [{ top: row * LINE, bottom: row * LINE + LINE, left: 0, right: 1, width: 1, height: LINE }];
  };
});
afterEach(() => {
  delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  document.body.innerHTML = '';
});

const layout = (html: string) => {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById('root') as HTMLElement;
};
const words = (html: string) => readLines(layout(html), BOX).map((l) => l.text);

describe('readLines skips what a note says', () => {
  const PLAIN = '<div class="kb-bb"><p>first line</p><p>second line</p></div>';

  test('a hidden line in the body\'s words is not a line of the post', () => {
    const withAside = '<div class="kb-bb"><p>first line</p><span data-kb-quotable="hidden" data-dw-aside><span>the note says this</span></span><p>second line</p></div>';
    expect(words(PLAIN)).toEqual(['first line', 'second line']);
    expect(words(withAside)).toEqual(words(PLAIN));
  });

  test('a drawn note and a receipt outside the body\'s words are not lines of the post', () => {
    const withNotes = `${PLAIN}<aside data-dw-aside><p>a drawn note</p></aside><div data-dw-aside><b>receipt</b> for 3 notes</div>`;
    expect(words(withNotes)).toEqual(words(PLAIN));
  });
});
