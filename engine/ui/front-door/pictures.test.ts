/**
 * The front door's staged pictures (engine/ui/front-door/pictures.ts).
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test engine/ui/front-door/pictures.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absolutePictures, absoluteSrc, CHECK_ORIGIN, writtenSrc } from './pictures.ts';

test('a root-relative picture is made absolute, and nothing else is touched', () => {
  assert.equal(absolutePictures('a [img]/x/a.gif[/img] b [img]https://h/b.gif[/img] [img]//evil/c.gif[/img] [img]/\\evil.com/a.png[/img]', 'https://o'), 'a [img]https://o/x/a.gif[/img] b [img]https://h/b.gif[/img] [img]//evil/c.gif[/img] [img]/\\evil.com/a.png[/img]');
  assert.equal(absoluteSrc('/x/a.gif', 'https://o'), 'https://o/x/a.gif');
  assert.equal(absoluteSrc('//evil/c.gif', 'https://o'), '//evil/c.gif');
  assert.equal(absoluteSrc('/\\evil.com/a.png', 'https://o'), '/\\evil.com/a.png');
});

test('an address made absolute against the check origin goes back to what was written', () => {
  assert.equal(writtenSrc(absoluteSrc('/x/a.gif', CHECK_ORIGIN)), '/x/a.gif');
  assert.equal(writtenSrc('https://h/b.gif'), 'https://h/b.gif');
});
