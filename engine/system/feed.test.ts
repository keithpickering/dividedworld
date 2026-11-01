import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedTitles } from './feed.ts';

test('RSS item titles are read, CDATA unwrapped, entities decoded, markup dropped, and the channel\'s own title left out', () => {
  const xml = `<rss><channel><title>The Site</title>
    <item><title>Plain &amp; simple</title><link>https://x</link><description>never read</description></item>
    <item><title><![CDATA[Cdata <b>stays</b> literal &amp; raw]]></title></item>
    <item><title>Num &#233;ric &#x41; &bogus; <i>tag</i></title></item>
    <item><link>no title</link></item>
    <item><title>   </title></item></channel></rss>`;
  assert.deepEqual(feedTitles(xml, 10), ['Plain & simple', 'Cdata <b>stays</b> literal &amp; raw', 'Num éric A &bogus; tag']);
});

test('Atom entries are read, the list and each title are capped, and a title that is not text is nothing', () => {
  const xml = `<feed><title>Feed</title>${Array.from({ length: 5 }, (_, i) => `<entry><title type="html">Entry ${i} ${'x'.repeat(300)}</title></entry>`).join('')}</feed>`;
  const titles = feedTitles(xml, 3, 20);
  assert.equal(titles.length, 3);
  assert.ok(titles.every((t) => t.length === 20));
  assert.deepEqual(feedTitles('not xml at all', 5), []);
  assert.deepEqual(feedTitles('<item><title>&#0;&#xD800;</title></item>', 5), []);
});
