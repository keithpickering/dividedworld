/**
 * The Strategy Guide's Markdown (engine/ui/guide/markdown.ts), under node's runner like the other pure `.test.ts` files in engine/.
 * Each construct the guide uses is parsed here; raw HTML is text, never markup; an unsafe link is only its words; a marker is a block
 * of its own; and a `{{setting:<path>}}` resolves against the live settings as the HUD says them (Aura as two decimals, a span as words).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKERS, parse, settingText, slug, type Block, type Inline } from './markdown.ts';
import type { ScreenSettings } from '../data/api.ts';

const text = (t: string): Inline => ({ t: 'text', text: t });

describe('blocks', () => {
  test('headings keep their level and their words', () => {
    assert.deepEqual(parse('## Reactions\n\n### Why'), [
      { t: 'heading', level: 2, children: [text('Reactions')] },
      { t: 'heading', level: 3, children: [text('Why')] },
    ]);
  });
  test('a paragraph joins its lines with a space and ends at a blank line', () => {
    assert.deepEqual(parse('One\ntwo.\n\nThree.'), [
      { t: 'p', children: [text('One two.')] },
      { t: 'p', children: [text('Three.')] },
    ]);
  });
  test('bold, italic, code and a link are inline, nested where they nest', () => {
    const [p] = parse('A **bold *and italic* word**, _soft_, `code` and [a link](/guide#classes).') as [Extract<Block, { t: 'p' }>];
    assert.deepEqual(p.children, [
      text('A '),
      { t: 'strong', children: [text('bold '), { t: 'em', children: [text('and italic')] }, text(' word')] },
      text(', '),
      { t: 'em', children: [text('soft')] },
      text(', '),
      { t: 'code', text: 'code' },
      text(' and '),
      { t: 'link', href: '/guide#classes', children: [text('a link')] },
      text('.'),
    ]);
  });
  test('bulleted and numbered lists hold one item each, a continuation line joins its item', () => {
    assert.deepEqual(parse('- one\n- two\n  more\n\n1. first\n2. second'), [
      { t: 'ul', items: [[text('one')], [text('two more')]] },
      { t: 'ol', items: [[text('first')], [text('second')]] },
    ]);
  });
  test('a table has a header row and body rows, and a cell is inline', () => {
    assert.deepEqual(parse('| Name | Cost |\n| --- | ---: |\n| **Whoops!** | {{setting:walletCap}} |\n| Bluff | 1 |'), [
      {
        t: 'table',
        head: [[text('Name')], [text('Cost')]],
        rows: [
          [[{ t: 'strong', children: [text('Whoops!')] }], [{ t: 'setting', path: 'walletCap' }]],
          [[text('Bluff')], [text('1')]],
        ],
      },
    ]);
  });
  test('a block quote holds blocks of its own', () => {
    assert.deepEqual(parse('> Quote **me**.\n>\n> Twice.'), [
      { t: 'quote', blocks: [{ t: 'p', children: [text('Quote '), { t: 'strong', children: [text('me')] }, text('.')] }, { t: 'p', children: [text('Twice.')] }] },
    ]);
  });
  test('a rule is a rule', () => {
    assert.deepEqual(parse('Above\n\n---\n\nBelow'), [{ t: 'p', children: [text('Above')] }, { t: 'hr' }, { t: 'p', children: [text('Below')] }]);
  });
});

describe('no raw HTML', () => {
  test('a tag, a script and an entity are shown as the text they are', () => {
    assert.deepEqual(parse('<script>alert(1)</script> and <b>bold?</b> &amp; <img src=x onerror=alert(1)>'), [
      { t: 'p', children: [text('<script>alert(1)</script> and <b>bold?</b> &amp; <img src=x onerror=alert(1)>')] },
    ]);
    assert.deepEqual(parse('<div>\nhi\n</div>'), [{ t: 'p', children: [text('<div> hi </div>')] }]);
  });
  test('a link goes only to http, https, a path or a fragment; any other is its words alone', () => {
    const link = (href: string) => (parse(`[go](${href})`)[0] as Extract<Block, { t: 'p' }>).children;
    assert.deepEqual(link('https://dw.gripe/x'), [{ t: 'link', href: 'https://dw.gripe/x', children: [text('go')] }]);
    assert.deepEqual(link('http://example.com'), [{ t: 'link', href: 'http://example.com', children: [text('go')] }]);
    assert.deepEqual(link('/guide'), [{ t: 'link', href: '/guide', children: [text('go')] }]);
    assert.deepEqual(link('#classes'), [{ t: 'link', href: '#classes', children: [text('go')] }]);
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', '//evil.example/x', 'vbscript:x']) {
      assert.deepEqual(link(bad), [text('go')], bad);
    }
  });
});

describe('markers and comments', () => {
  test('a marker on a line of its own is a block, whatever the spacing', () => {
    assert.deepEqual(parse('<!-- kayfabb:classes -->\n\nText\n\n<!--kayfabb:cards-->'), [
      { t: 'marker', name: 'classes' },
      { t: 'p', children: [text('Text')] },
      { t: 'marker', name: 'cards' },
    ]);
  });
  test('the engine knows the letter, the reactions, the classes and the cards', () => {
    assert.deepEqual([...MARKERS].sort(), ['cards', 'classes', 'letter', 'reactions']);
  });
  test('an ordinary comment, one line or many, is for the author and is dropped', () => {
    assert.deepEqual(parse('<!-- a note -->\n\n<!--\n  a longer\n  note\n-->\n\nText'), [{ t: 'p', children: [text('Text')] }]);
  });
  test('an unknown marker is still a marker block, so the check can name it', () => {
    assert.deepEqual(parse('<!-- kayfabb:nonsense -->'), [{ t: 'marker', name: 'nonsense' }]);
  });
  test('a {{setting:path}} is inline, in a paragraph or a list', () => {
    assert.deepEqual(parse('Up to {{setting:charactersPerPlayer}} masks.\n\n- {{setting:turnCooldown}}'), [
      { t: 'p', children: [text('Up to '), { t: 'setting', path: 'charactersPerPlayer' }, text(' masks.')] },
      { t: 'ul', items: [[{ t: 'setting', path: 'turnCooldown' }]] },
    ]);
  });
});

describe('slug', () => {
  test('an anchor is lowercase words joined by hyphens', () => {
    assert.equal(slug('Turns and reveals'), 'turns-and-reveals');
    assert.equal(slug('  The "System"! '), 'the-system');
    assert.equal(slug('Whoops! 2'), 'whoops-2');
  });
});

describe('settingText', () => {
  const settings = {
    walletCap: 600, charactersPerPlayer: 6, reactionCap: 3, postsPerPage: 20,
    turnCooldown: { unit: 'day', count: 30 }, settlementLength: { unit: 'day', count: 1 }, editGrace: { unit: 'minute', count: 2 },
    registrationMode: 'invite', toastDefaults: ['quote'],
    cardSettings: { 'whoops.clean': 95 },
    cardEconomy: { 'whoops.price': 100, 'whoops.lengthStep': 500, 'lurker.crowd': 3 },
  } as unknown as ScreenSettings;
  test('the wallet and a card\'s price are Aura, as the HUD says it: hundredths as two decimals', () => {
    assert.equal(settingText('walletCap', settings), '6.00');
    assert.equal(settingText('cardEconomy.whoops.price', settings), '1.00');
  });
  test('a count is the plain number, and a span is said as a player says it', () => {
    assert.equal(settingText('charactersPerPlayer', settings), '6');
    assert.equal(settingText('cardEconomy.whoops.lengthStep', settings), '500');
    assert.equal(settingText('cardSettings.whoops.clean', settings), '95');
    assert.equal(settingText('turnCooldown', settings), '30 days');
    assert.equal(settingText('settlementLength', settings), '1 day');
    assert.equal(settingText('editGrace', settings), '2 minutes');
  });
  test('a path the settings do not have, or that is not a number or a span, is nothing', () => {
    for (const path of ['nope', 'cardEconomy.nope', 'registrationMode', 'toastDefaults', 'cardEconomy', 'toString', '__proto__', 'constructor.name', '']) {
      assert.equal(settingText(path, settings), undefined, path);
    }
  });
});
