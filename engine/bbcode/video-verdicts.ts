/**
 * The verdicts of `videoOf` (video.ts) over a few thousand generated addresses, written to supabase/tests/data/video-verdicts.json.
 *
 * Why: conceal_quotes (supabase/migrations/0236_conduct.sql) reads `[video]` contents with bb_video_like, a SQL mirror of videoOf, to know whether a `[quote=…]` inside is words
 * or hidden inside a video. If SQL says "words" where the parser says "video" the quote is emptied for nothing (safe); if SQL says "video" where the parser says "words"
 * a hidden post's quote stays readable (a leak). supabase/tests/0164-conduct-leaks.sql holds the SQL to this fixture in that one direction, and video-verdicts.test.ts
 * holds the fixture to a fresh generation, so it moves with video.ts and the guard cannot go stale.
 *
 * Regenerate after a change to video.ts: `node --experimental-strip-types --no-warnings=ExperimentalWarning engine/bbcode/video-verdicts.ts`.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { videoOf } from './video.ts';

export const FIXTURE = new URL('../../supabase/tests/data/video-verdicts.json', import.meta.url);

const ID = 'abcdefghijk';
const HOSTS = [
  'youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'vimeo.com', 'www.vimeo.com', 'clips.twitch.tv', 'twitch.tv', 'www.twitch.tv', 'streamable.com',
  'www.streamable.com', 'nicovideo.jp', 'www.nicovideo.jp', 'soundcloud.com', 'www.soundcloud.com', 'YOUTU.BE', 'YouTube.com',
  'example.com', 'files.example.org', 'a.b.c.example.net', 'example', 'localhost', 'youtube.com.evil.example', 'evilyoutube.com',
  'xn--80ak6aa92e.com', 'xn--', 'xn--a.example', 'example.xn--p1ai', 'xn--zz.example.com', 'ex-ample.com', 'a-.com', '-a.com', 'a..b.com', '.example.com', 'example.com.',
  'example.123', 'example.0x1f', 'example.0x', 'example.0X1F', '1.2.3.4', '1.2.3.256', '1.2.3', '1.2', '256', '0x7f.1', '0x7f000001', '127.1', '01.02.03.04', '1.2.3.4.5', 'a.1.com', 'a.1', 'example.1a', 'example.a1',
  '[::1]', 'user@example.com', 'ex ample.com', 'exa_mple.com', 'ex%61mple.com', 'exämple.com', 'example.cöm',
];
const PATHS = [
  '', '/', `/${ID}`, `/${ID}/`, `/${ID}/extra`, '/a', '/a/b', '/a/b/', '/a/b/c', '/a/b.mp4', '/a.mp4', '/a.webm', '/a.MP4', '/A.WebM', '/a.mp4/', '/a.mp4x', '/a.txt', '/a.mp4.txt',
  '/watch', '/watch/sm9', '/shorts/' + ID, '/live/' + ID, '/123456', '/123/456', '/abc', '/abc123', '/sm9', '/name/clip/SomeClip', '/name/clip', '/SomeClip-1',
  '/a/./b.mp4', '/a/../b.mp4', '/a/%2e%2e/b.mp4', '/a/%2E/b.mp4', '/%61.mp4', '/a%2fb.mp4', '/a b.mp4', '//a.mp4', '/[quote=x]y.mp4', '/a;b.mp4', '/é.mp4', `/${ID}.mp4`,
];
const QUERIES = ['', '?v=' + ID, '?v=short', '?x=1&v=' + ID, '?x=' + ID, '?t=90', '?v=' + ID + '&t=1m30s', '?%76=' + ID, '?v%3D' + ID, '?a+b=1&v=' + ID, '?v=' + ID + '&v=other', '?v=', '?', '?v=%41bcdefghijk'];
const FRAGMENTS = ['', '#t=90', '#x'];
const PORTS = ['', ':', ':443', ':80', ':8080', ':65536', ':99999', ':0443', ':abc'];

export function addresses(): string[] {
  const out = new Set<string>();
  for (const host of HOSTS) {
    for (const path of PATHS) out.add(`https://${host}${path}`);
    for (const path of PATHS.slice(0, 12)) out.add(`http://${host}${path}`);
    for (const scheme of ['HTTPS', 'ftp', 'javascript']) out.add(`${scheme}://${host}/${ID}`);
    for (const scheme of ['HTTPS', 'ftp']) out.add(`${scheme}://${host}/a.mp4`);
  }
  for (const host of HOSTS.slice(0, 15)) {
    for (const port of PORTS) for (const path of ['', `/${ID}`, '/a.mp4']) out.add(`https://${host}${port}${path}`);
    for (const path of ['/watch', '/', `/${ID}`, '/a.mp4']) for (const q of QUERIES) for (const f of FRAGMENTS) out.add(`https://${host}${path}${q}${f}`);
  }
  for (const bare of [ID, 'short', '', ' ', 'youtu.be/' + ID, '//youtu.be/' + ID, '/a.mp4', 'https:/youtu.be/' + ID, 'https:youtu.be/' + ID, 'https://', 'https:///a.mp4', `https://user:pw@youtu.be/${ID}`, `https://youtu.be\\${ID}`, `https://youtu.be/${ID}\n`, `https://you\ttu.be/${ID}`]) out.add(bare);
  return [...out].sort();
}

export function generate(): Record<string, 'video' | 'words'> {
  const verdicts: Record<string, 'video' | 'words'> = {};
  for (const a of addresses()) verdicts[a] = videoOf(a) === null ? 'words' : 'video';
  return verdicts;
}

export function serialize(v: Record<string, 'video' | 'words'>): string {
  return JSON.stringify(v, null, 1) + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const v = generate();
  fs.writeFileSync(FIXTURE, serialize(v));
  const n = Object.values(v).filter((x) => x === 'video').length;
  console.log(`wrote ${Object.keys(v).length} verdicts (${n} video)`);
}
