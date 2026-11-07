/**
 * Video: a pure table from a URL a player pasted to the player that plays it. The URL first goes
 * through `safeImageSrc`, so the address checks are the images' (http or https, a real ASCII host
 * with no credentials, no control characters, whitespace or quotes). Each provider then accepts
 * only its own hosts, compared whole (`youtube.com.evil.example` and `evilyoutube.com` are not
 * YouTube) and only ids made of its own character set, so nothing but an id reaches a player
 * address. A URL no row matches is `null`, and the parser leaves it as text.
 *
 * Nothing here loads anything: `src` is the address the renderer puts in a frame after the reader
 * presses Play (engine/ui/bbcode/Video.tsx). Twitch's `parent` is the page's own host, which the
 * engine does not know, so the renderer appends `&parent=` to a Twitch `src`.
 */
import { safeImageSrc } from './parse.ts';

export type VideoProvider = 'youtube' | 'vimeo' | 'twitch' | 'streamable' | 'niconico' | 'soundcloud' | 'file';

export interface Video {
  readonly provider: VideoProvider;
  /** The provider's id for it (for a file, its address). */
  readonly id: string;
  /** Seconds in to start from, where the URL said (YouTube). */
  readonly start?: number;
  /** What a frame (or, for a file, a `<video>`) loads. Twitch's lacks `parent`. */
  readonly src: string;
  /** The address as written, checked: shown in the box as a link. */
  readonly url: string;
}

/** The hosts a player frame loads from, exactly: the page's `frame-src` is this list (web/headers.ts). */
export const PLAYER_HOSTS: readonly string[] = [
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'clips.twitch.tv',
  'streamable.com',
  'embed.nicovideo.jp',
  'w.soundcloud.com',
];

/** An id as YouTube spells it. */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_CLIP = /^[A-Za-z0-9_-]{1,100}$/;
const STREAMABLE_ID = /^[a-z0-9]{3,16}$/i;
const NICO_ID = /^(?:sm|nm|so)[0-9]{1,12}$/;
const VIMEO_ID = /^[0-9]{1,12}$/;
const SC_SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_START = 24 * 60 * 60 * 7;

/** `90`, `90s`, `1m30s`, `1h2m3s` as seconds, or null. */
function seconds(raw: string): number | null {
  const m = /^(?:([0-9]{1,6})$|(?:([0-9]{1,3})h)?(?:([0-9]{1,4})m)?(?:([0-9]{1,6})s)?$)/i.exec(raw);
  if (!m || raw === '') return null;
  const n = m[1] !== undefined ? Number(m[1]) : Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return n > 0 && n <= MAX_START ? n : null;
}

function startOf(u: URL): number | undefined {
  const frag = u.hash.startsWith('#t=') ? u.hash.slice(3) : null;
  for (const v of [u.searchParams.get('t'), u.searchParams.get('start'), frag]) {
    if (v === null) continue;
    const s = seconds(v);
    if (s !== null) return s;
  }
  return undefined;
}

function youtube(id: string, u: URL): Video | null {
  if (!YOUTUBE_ID.test(id)) return null;
  const start = startOf(u);
  const base = `https://www.youtube-nocookie.com/embed/${id}`;
  return {
    provider: 'youtube', id, ...(start === undefined ? {} : { start }),
    src: start === undefined ? base : `${base}?start=${start}`,
    url: u.href,
  };
}

/** The player for a URL, or null when no provider recognizes it. */
export function videoOf(raw: string): Video | null {
  const checked = safeImageSrc(raw);
  if (checked === null) return null;
  let u: URL;
  try { u = new URL(checked); } catch { return null; }
  if (u.port !== '') return null;
  const host = u.hostname.toLowerCase();
  /* Segments of the path, a trailing slash tolerated. */
  const seg = u.pathname.replace(/\/$/, '').split('/').slice(1);
  const [a, b, c] = seg;

  if (host === 'youtu.be') return seg.length === 1 ? youtube(a ?? '', u) : null;
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (seg.length === 1 && a === 'watch') return youtube(u.searchParams.get('v') ?? '', u);
    if (seg.length === 2 && (a === 'shorts' || a === 'live')) return youtube(b ?? '', u);
    return null;
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    return seg.length === 1 && VIMEO_ID.test(a ?? '')
      ? { provider: 'vimeo', id: a as string, src: `https://player.vimeo.com/video/${a}?dnt=1`, url: u.href }
      : null;
  }
  if (host === 'clips.twitch.tv') {
    return seg.length === 1 && TWITCH_CLIP.test(a ?? '')
      ? { provider: 'twitch', id: a as string, src: `https://clips.twitch.tv/embed?clip=${a}`, url: u.href }
      : null;
  }
  if (host === 'twitch.tv' || host === 'www.twitch.tv') {
    return seg.length === 3 && SC_SEGMENT.test(a ?? '') && b === 'clip' && TWITCH_CLIP.test(c ?? '')
      ? { provider: 'twitch', id: c as string, src: `https://clips.twitch.tv/embed?clip=${c}`, url: u.href }
      : null;
  }
  if (host === 'streamable.com' || host === 'www.streamable.com') {
    return seg.length === 1 && STREAMABLE_ID.test(a ?? '')
      ? { provider: 'streamable', id: a as string, src: `https://streamable.com/e/${a}`, url: u.href }
      : null;
  }
  if (host === 'nicovideo.jp' || host === 'www.nicovideo.jp') {
    return seg.length === 2 && a === 'watch' && NICO_ID.test(b ?? '')
      ? { provider: 'niconico', id: b as string, src: `https://embed.nicovideo.jp/watch/${b}`, url: u.href }
      : null;
  }
  if (host === 'soundcloud.com' || host === 'www.soundcloud.com') {
    if (seg.length !== 2 || !SC_SEGMENT.test(a ?? '') || !SC_SEGMENT.test(b ?? '')) return null;
    const page = `https://soundcloud.com/${a}/${b}`;
    return { provider: 'soundcloud', id: `${a}/${b}`, src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}`, url: u.href };
  }
  if (u.protocol === 'https:' && /\.(?:mp4|webm)$/i.test(u.pathname)) {
    return { provider: 'file', id: u.href, src: u.href, url: u.href };
  }
  return null;
}
