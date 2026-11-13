import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parse } from '../../bbcode/parse.ts';
import { openThread, replyBox, threadWorld } from '../composer/support.tsx';
import { quoteText } from '../composer/text.ts';
import { readRange } from './SelectionQuote.tsx';
import { render } from '@testing-library/react';
import { BbCode } from '../bbcode/render.tsx';
import { RouterProvider } from '../router.tsx';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Two posts' bodies as the thread draws them: the article, its words cell and the BbCode's own box. */
function page(...bodies: string[]) {
  document.body.innerHTML = bodies.map((html, i) => `<article class="kb-act" data-kb-seq="${i + 1}"><div class="kb-act-main"><div class="kb-bb">${html}</div></div></article>`).join('');
  return [...document.querySelectorAll<HTMLElement>('.kb-bb')];
}
function range(a: Node, ao: number, b: Node, bo: number) {
  const r = document.createRange();
  r.setStart(a, ao);
  r.setEnd(b, bo);
  return r;
}

describe('what a selection reads as (readRange)', () => {
  test('a selection inside one body is that post\'s words and only the selected ones', () => {
    const [one] = page('hello brave world');
    const t = one!.firstChild!;
    expect(readRange(range(t, 6, t, 11))).toMatchObject({ seq: 1, text: 'brave', body: one });
  });

  test('a selection inside a reply drawn under a post is that reply\'s words, by the number it carries as its own', () => {
    document.body.innerHTML = '<article class="kb-act" data-kb-seq="3"><div class="kb-bb">parent words</div></article><article class="kb-act" data-kb-under="" data-kb-cut-seq="46"><div class="kb-bb">excuse me please</div></article>';
    const t = document.querySelectorAll('.kb-bb')[1]!.firstChild!;
    expect(readRange(range(t, 0, t, 6))).toMatchObject({ seq: 46, text: 'excuse' });
  });

  test('a selection across two posts, or outside a body, reads as nothing', () => {
    const [one, two] = page('first words', 'second words');
    expect(readRange(range(one!.firstChild!, 2, two!.firstChild!, 4))).toBeNull();
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.append(outside);
    expect(readRange(range(outside.firstChild!, 0, outside.firstChild!, 5))).toBeNull();
    expect(readRange(range(outside.firstChild!, 0, one!.firstChild!, 3))).toBeNull();
  });

  test('a signature is not a post body', () => {
    document.body.innerHTML = '<article class="kb-act" data-kb-seq="1"><div class="kb-signature"><div class="kb-bb">sig words</div></div></article>';
    const t = document.querySelector('.kb-bb')!.firstChild!;
    expect(readRange(range(t, 0, t, 3))).toBeNull();
  });

  test('two paragraphs inside one post keep their line break', () => {
    const [one] = page('<p>first line</p><p>second line</p>');
    const [p1, p2] = one!.querySelectorAll('p');
    expect(readRange(range(p1!.firstChild!, 6, p2!.firstChild!, 6))?.text).toBe('line\nsecond');
  });

  test('a line break written in the words stays one', () => {
    const [one] = page('a\nb<br>c');
    const r = range(one!, 0, one!, one!.childNodes.length);
    expect(readRange(r)?.text).toBe('a\nb\nc');
  });

  test('a paragraph picked by a triple click, which ends at the start of the next element, still reads', () => {
    const [one] = page('<p>whole paragraph</p><p>next</p>');
    const [p1, p2] = one!.querySelectorAll('p');
    expect(readRange(range(p1!.firstChild!, 0, p2!, 0))?.text).toBe('whole paragraph');
  });

  test('hidden words are never read: a shut inline spoiler, its "Spoiler" name, a shut spoiler\'s body, an image\'s alt, a Lens overlay', () => {
    const [one] = page(
      'before <button class="kb-bb-ispoiler"><span aria-hidden="true">the butler</span><span class="kb-visually-hidden">Spoiler</span></button> '
      + '<details class="kb-bb-spoiler"><summary>Plot</summary><div>shut body</div></details> '
      + '<img alt="Image from cdn.example" src="https://cdn.example/a.png"> '
      + '<span class="kb-lens" aria-hidden="true">overlay words</span><span hidden>gone</span> after',
    );
    const r = range(one!, 0, one!, one!.childNodes.length);
    const text = readRange(r)?.text ?? '';
    expect(text).toContain('before');
    expect(text).toContain('after');
    for (const hidden of ['butler', 'Spoiler', 'shut body', 'Image from', 'overlay', 'gone']) expect(text).not.toContain(hidden);
  });

  test('a spoiler opened is read, and a nested quote\'s author line is not', () => {
    const [one] = page(
      '<button class="kb-bb-ispoiler">shown now</button> <details class="kb-bb-spoiler" open><summary>Plot</summary><div>open body</div></details>'
      + '<blockquote class="kb-quote"><cite class="kb-quote-from">Ana wrote</cite><div class="kb-quote-body">her words</div></blockquote>',
    );
    const text = readRange(range(one!, 0, one!, one!.childNodes.length))?.text ?? '';
    expect(text).toContain('shown now');
    expect(text).toContain('open body');
    expect(text).toContain('her words');
    expect(text).not.toContain('Ana wrote');
  });

  test('a selection of hidden words alone reads as nothing', () => {
    const [one] = page('x <span aria-hidden="true">secret</span>');
    const hidden = one!.querySelector('span')!.firstChild!;
    expect(readRange(range(hidden, 0, hidden, 6))).toBeNull();
  });
});

/** A post drawn by the real BbCode renderer, in the article a body lives in. */
function drawn(text: string) {
  document.body.innerHTML = '';
  render(<RouterProvider><article className="kb-act" data-kb-seq="1"><BbCode text={text} /></article></RouterProvider>);
  const body = document.querySelector<HTMLElement>('.kb-bb')!;
  return { body, all: () => readRange(range(body, 0, body, body.childNodes.length))?.text ?? '' };
}

describe('chrome and layers are not quoted (data-kb-quotable)', () => {
  test('a marquee\'s Pause button is chrome: the whole marquee quotes only its words', () => {
    expect(drawn('[marquee]hello[/marquee]').all()).toBe('hello');
  });

  test('a video\'s face text, Play button and address label are chrome', () => {
    expect(drawn('before [video]https://vimeo.com/123[/video] after').all()).toBe('before\nafter');
  });

  test('code keeps its indent, first line included', () => {
    expect(drawn('[code]    def f():\n    return 1[/code]').all()).toBe('    def f():\n    return 1');
  });

  test('text a post shows although it is aria-hidden is read, and the words under it are not', () => {
    const [one] = page(
      'I said <span class="x"><span aria-hidden="true" data-kb-quotable="hidden">NAUGHTY</span><span aria-hidden="true" data-kb-quotable="shown">Hello</span></span> today',
    );
    expect(readRange(range(one!, 0, one!, one!.childNodes.length))?.text).toBe('I said Hello today');
  });

  test('"shown" outranks aria-hidden on its own element, and "hidden" inside shown words still wins', () => {
    const [one] = page('a <span aria-hidden="true" data-kb-quotable="shown">shown<i data-kb-quotable="hidden"> not</i> words</span> b');
    expect(readRange(range(one!, 0, one!, one!.childNodes.length))?.text).toBe('a shown words b');
  });

  test('the "as it landed" moment and the history panel hold older versions, not this act\'s words', () => {
    document.body.innerHTML = '<article class="kb-act" data-kb-seq="1"><div class="kb-bb">now words</div>'
      + '<div class="kb-moment-body" data-kb-quotable="hidden"><div class="kb-bb">older words</div></div>'
      + '<ol class="kb-post-history" data-kb-quotable="hidden"><li><div class="kb-bb">oldest words</div></li></ol></article>';
    const [now, moment, history] = [...document.querySelectorAll<HTMLElement>('.kb-bb')];
    const article = document.querySelector('article')!;
    expect(readRange(range(article, 0, article, article.childNodes.length))).toBeNull();
    expect(readRange(range(moment!.firstChild!, 0, moment!.firstChild!, 5))).toBeNull();
    expect(readRange(range(history!.firstChild!, 0, history!.firstChild!, 5))).toBeNull();
    expect(readRange(range(now!.firstChild!, 0, now!.firstChild!, 3))?.text).toBe('now');
  });
});

describe('quoteText of a selection', () => {
  const read = (text: string) => {
    const nodes = parse(quoteText('', '11111111-1111-4111-8111-111111111111', text, true));
    const quote = nodes[0]!;
    if (quote.type !== 'quote') throw new Error(`not one quote: ${JSON.stringify(nodes)}`);
    return quote.children;
  };
  const words = (kids: ReturnType<typeof read>) => kids.map((k) => (k.type === 'text' || k.type === 'noparse' ? k.text : `<${k.type}>`)).join('');

  test('plain words are quoted as the whole-post quote quotes them', () => {
    expect(quoteText('', 'id1', 'just words', true)).toBe('[quote=id1]just words[/quote]\n');
  });

  test('words that would parse as a tag are kept as typed, in noparse', () => {
    expect(quoteText('', 'id1', 'use [b]bold[/b] here', true)).toBe('[quote=id1][noparse]use [b]bold[/b] here[/noparse][/quote]\n');
    expect(words(read('use [b]bold[/b] here'))).toBe('use [b]bold[/b] here');
    expect(read('[b]').map((k) => k.type)).toEqual(['noparse']);
  });

  test('the whole-post quote still holds its markup live', () => {
    expect(quoteText('', 'id1', '[b]x[/b]')).toBe('[quote=id1][b]x[/b][/quote]\n');
  });

  test.each(['x [/noparse] [b]y[/b]', '[/NoParse]', '[b]a[/noparse]', '[/noparse][/noparse]', '[/quote] [url=javascript:alert(1)]z[/url]'])('text holding a closer, %j, cannot end the cover early', (text) => {
    const kids = read(text);
    expect(kids.every((k) => k.type === 'noparse' || k.type === 'text')).toBe(true);
    expect(words(kids)).toBe(text);
  });
});

describe('the Quote button on the thread', () => {
  const select = (node: Node, from: number, to: number) => {
    act(() => {
      window.getSelection()!.setBaseAndExtent(node, from, node, to);
      document.dispatchEvent(new Event('selectionchange'));
    });
  };
  /* The reply box is drawn once the board is known, and the button is offered with it: wait for it before selecting. */
  const bodyOf = async (seq: number) => {
    const article = await screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });
    await replyBox();
    return article.querySelector('[data-kb-cell="words"] .kb-bb')!;
  };
  const offer = () => screen.queryByRole('button', { name: 'Quote the selected text' });

  test('a selection in one post offers the button, and pressing it quotes only the selection and clears it', async () => {
    const w = threadWorld(3);
    const id = w.fake.seed.post(w.thread, w.pipe, 'the quick brown fox');
    openThread(w);
    const body = await bodyOf(4);
    expect(offer()).toBeNull();
    select(body.firstChild!, 4, 9);
    await userEvent.click(await screen.findByRole('button', { name: 'Quote the selected text' }));
    expect(await replyBox()).toHaveValue(`[quote=${id}]quick[/quote]\n`);
    expect(window.getSelection()!.isCollapsed).toBe(true);
    expect(offer()).toBeNull();
  });

  test('a press dragged off the button, or cancelled, does not leave a stale button behind', async () => {
    const w = threadWorld(3);
    openThread(w);
    const body = await bodyOf(2);
    for (const end of [(b: Element) => { b.dispatchEvent(new Event('pointerout', { bubbles: true })); }, (b: Element) => { b.dispatchEvent(new Event('pointercancel', { bubbles: true })); }, () => { document.dispatchEvent(new Event('pointerup')); }]) {
      select(body.firstChild!, 0, 4);
      const button = await screen.findByRole('button', { name: 'Quote the selected text' });
      act(() => { button.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
      act(() => end(button));
      act(() => { window.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
      await waitFor(() => expect(offer()).toBeNull());
    }
  });

  test('a selection across two posts offers none', async () => {
    const w = threadWorld(3);
    openThread(w);
    const [a, b] = [await bodyOf(2), await bodyOf(3)];
    act(() => {
      window.getSelection()!.setBaseAndExtent(a.firstChild!, 1, b.firstChild!, 3);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(offer()).toBeNull();
  });

  test('a selection holding [b] is quoted as text', async () => {
    const w = threadWorld(2);
    const id = w.fake.seed.post(w.thread, w.pipe, '[noparse]type [b] to bold[/noparse]');
    openThread(w);
    const body = await bodyOf(3);
    select(body.firstChild!, 0, 16);
    await userEvent.click(await screen.findByRole('button', { name: 'Quote the selected text' }));
    expect(await replyBox()).toHaveValue(`[quote=${id}][noparse]type [b] to bold[/noparse][/quote]\n`);
  });

  test('Esc dismisses it, and a new selection brings it back', async () => {
    const w = threadWorld(3);
    openThread(w);
    const body = await bodyOf(2);
    select(body.firstChild!, 0, 4);
    await screen.findByRole('button', { name: 'Quote the selected text' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(offer()).toBeNull());
    select(body.firstChild!, 0, 3);
    expect(await screen.findByRole('button', { name: 'Quote the selected text' })).toBeInTheDocument();
  });

  test('a click elsewhere dismisses it', async () => {
    const w = threadWorld(3);
    openThread(w);
    const body = await bodyOf(2);
    select(body.firstChild!, 0, 4);
    await screen.findByRole('button', { name: 'Quote the selected text' });
    await userEvent.click(document.body);
    await waitFor(() => expect(offer()).toBeNull());
  });

  test('a hidden spoiler\'s words are not quoted', async () => {
    const w = threadWorld(2);
    const id = w.fake.seed.post(w.thread, w.pipe, 'it was [ispoiler]the butler[/ispoiler] all along');
    openThread(w);
    const body = await bodyOf(3);
    act(() => {
      window.getSelection()!.setBaseAndExtent(body, 0, body, body.childNodes.length);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Quote the selected text' }));
    const value = (await replyBox() as HTMLTextAreaElement).value;
    expect(value).toContain(`[quote=${id}]`);
    expect(value).not.toContain('butler');
    expect(value).toContain('all along');
  });
});
