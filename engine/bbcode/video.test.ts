import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_HOSTS, videoOf } from './video.ts';

const ID = 'dQw4w9WgXcQ';
const yt = (src: string, extra: object = {}) => ({ provider: 'youtube', id: ID, src, ...extra });
const embed = `https://www.youtube-nocookie.com/embed/${ID}`;
const pick = (raw: string) => {
  const v = videoOf(raw);
  return v && { provider: v.provider, id: v.id, src: v.src, ...(v.start === undefined ? {} : { start: v.start }) };
};

test('every accepted form of YouTube', () => {
  for (const u of [
    `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&list=PL1`, `http://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`, `https://youtu.be/${ID}/`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}`,
    `  https://YOUTUBE.com/watch?v=${ID}  `,
  ]) assert.deepEqual(pick(u), yt(embed), u);
});

test('start times: t= and start=, seconds and 1h2m3s forms', () => {
  assert.deepEqual(pick(`https://youtu.be/${ID}?t=90`), yt(`${embed}?start=90`, { start: 90 }));
  assert.deepEqual(pick(`https://www.youtube.com/watch?v=${ID}&t=1m30s`), yt(`${embed}?start=90`, { start: 90 }));
  assert.deepEqual(pick(`https://www.youtube.com/watch?v=${ID}&start=45`), yt(`${embed}?start=45`, { start: 45 }));
  assert.deepEqual(pick(`https://youtu.be/${ID}?t=1h2m3s`), yt(`${embed}?start=3723`, { start: 3723 }));
  assert.deepEqual(pick(`https://youtu.be/${ID}?t=42s`), yt(`${embed}?start=42`, { start: 42 }));
  assert.deepEqual(pick(`https://youtu.be/${ID}#t=7`), yt(`${embed}?start=7`, { start: 7 }));
  for (const bad of ['abc', '-5', '0', '1m-2s', '99999999999']) assert.deepEqual(pick(`https://youtu.be/${ID}?t=${bad}`), yt(embed), bad);
});

test('the other providers', () => {
  assert.deepEqual(pick('https://vimeo.com/123456'), { provider: 'vimeo', id: '123456', src: 'https://player.vimeo.com/video/123456?dnt=1' });
  assert.deepEqual(pick('https://www.vimeo.com/9'), { provider: 'vimeo', id: '9', src: 'https://player.vimeo.com/video/9?dnt=1' });
  const tw = { provider: 'twitch', id: 'Funny-Clip_1', src: 'https://clips.twitch.tv/embed?clip=Funny-Clip_1' };
  assert.deepEqual(pick('https://clips.twitch.tv/Funny-Clip_1'), tw);
  assert.deepEqual(pick('https://www.twitch.tv/somebody/clip/Funny-Clip_1'), tw);
  assert.deepEqual(pick('https://twitch.tv/somebody/clip/Funny-Clip_1?filter=clips'), tw);
  assert.deepEqual(pick('https://streamable.com/ab12c'), { provider: 'streamable', id: 'ab12c', src: 'https://streamable.com/e/ab12c' });
  for (const id of ['sm9', 'nm123', 'so4567']) {
    assert.deepEqual(pick(`https://www.nicovideo.jp/watch/${id}`), { provider: 'niconico', id, src: `https://embed.nicovideo.jp/watch/${id}` });
  }
  assert.deepEqual(pick('https://soundcloud.com/some-artist/track_1'), {
    provider: 'soundcloud', id: 'some-artist/track_1',
    src: `https://w.soundcloud.com/player/?url=${encodeURIComponent('https://soundcloud.com/some-artist/track_1')}`,
  });
});

test('a file: an https address ending .mp4 or .webm', () => {
  assert.deepEqual(pick('https://cdn.example.com/a/clip.mp4'), { provider: 'file', id: 'https://cdn.example.com/a/clip.mp4', src: 'https://cdn.example.com/a/clip.mp4' });
  assert.equal(videoOf('https://cdn.example.com/CLIP.WEBM?x=1')?.provider, 'file');
  assert.equal(videoOf('http://cdn.example.com/clip.mp4'), null);
  assert.equal(videoOf('https://cdn.example.com/clip.mp4.exe'), null);
  assert.equal(videoOf('https://cdn.example.com/clip.gif'), null);
});

test('ids with characters outside the provider\'s set are refused', () => {
  for (const u of [
    'https://youtu.be/short', 'https://youtu.be/dQw4w9WgXcQQ', 'https://youtu.be/dQw4w9WgX"Q', 'https://www.youtube.com/watch?v=dQw4w9Wg%2FcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXc&', 'https://www.youtube.com/watch', 'https://www.youtube.com/shorts/', 'https://www.youtube.com/channel/abc',
    'https://vimeo.com/12ab', 'https://vimeo.com/channels/staffpicks', 'https://vimeo.com/',
    'https://clips.twitch.tv/a%26parent=evil', 'https://clips.twitch.tv/a.b', 'https://www.twitch.tv/x/clip/a%2Fb', 'https://www.twitch.tv/x/video/123',
    'https://streamable.com/a-b', 'https://streamable.com/e/abc/d',
    'https://www.nicovideo.jp/watch/xx123', 'https://www.nicovideo.jp/watch/sm12a', 'https://www.nicovideo.jp/watch/sm',
    'https://soundcloud.com/a', 'https://soundcloud.com/a/b/c', 'https://soundcloud.com/a%26b/c', 'https://soundcloud.com/a/b%3Fx', 'https://soundcloud.com/a/b.c',
  ]) assert.equal(videoOf(u), null, u);
});

test('lookalike hosts, ports and credentials are refused', () => {
  for (const host of ['youtube.com.evil.example', 'evilyoutube.com', 'youtube.com.', 'notyoutu.be', 'youtu.be.evil.example', 'www.youtube.com@evil.example', 'youtube.com:8080', 'vimeo.com.evil.example', 'evilvimeo.com', 'clips.twitch.tv.evil.example', 'xsoundcloud.com']) {
    assert.equal(videoOf(`https://${host}/watch?v=${ID}`), null, host);
    assert.equal(videoOf(`https://${host}/${ID}`), null, host);
    assert.equal(videoOf(`https://${host}/123`), null, host);
    assert.equal(videoOf(`https://${host}/a/b`), null, host);
  }
});

test('not a URL at all: refused', () => {
  for (const u of ['', 'javascript:alert(1)', 'data:video/mp4;base64,AAAA', '/clip.mp4', '//youtu.be/' + ID, 'ftp://youtu.be/' + ID, 'hello', ID]) assert.equal(videoOf(u), null, u);
});

test('no video carries anything but an id into its player address', () => {
  assert.deepEqual([...PLAYER_HOSTS].sort(), [
    'clips.twitch.tv', 'embed.nicovideo.jp', 'player.vimeo.com', 'streamable.com', 'w.soundcloud.com', 'www.youtube-nocookie.com',
  ]);
  for (const u of [`https://youtu.be/${ID}`, 'https://vimeo.com/1', 'https://clips.twitch.tv/a', 'https://streamable.com/abc', 'https://www.nicovideo.jp/watch/sm1', 'https://soundcloud.com/a/b']) {
    const v = videoOf(u);
    assert.ok(v && PLAYER_HOSTS.includes(new URL(v.src).hostname), u);
  }
});
