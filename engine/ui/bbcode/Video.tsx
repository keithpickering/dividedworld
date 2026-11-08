/**
 * A post's [video]. Shut, it is a box with a Play button and the address as a link: nothing from the
 * video's provider loads until the reader presses Play, except YouTube's thumbnail (the address is fixed
 * by the id; the owner took that trade as for [img]). Pressed, the box becomes the player: a sandboxed
 * iframe at the address engine/bbcode/video.ts made, or for a file a native `<video>`; focus moves to it.
 * The address stays in view as a link, so a player that will not load still gives the reader the address.
 * The state is the reader's alone: nothing stores it and nothing is sent.
 */
import { useEffect, useRef, useState } from 'react';
import type { Video as VideoData, VideoProvider } from '../../bbcode/video.ts';

const REL = 'noopener noreferrer nofollow ugc';

const NAMES: Readonly<Record<VideoProvider, string>> = {
  youtube: 'YouTube', vimeo: 'Vimeo', twitch: 'Twitch', streamable: 'Streamable', niconico: 'Niconico', soundcloud: 'SoundCloud', file: 'File',
};

/** "host/path" of the address, for the box. */
function labelOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch { return url; }
}

/** The address a frame loads; Twitch's player is told the page it sits in, which only the page knows. */
function frameSrc(v: VideoData): string {
  return v.provider === 'twitch' ? `${v.src}&parent=${encodeURIComponent(location.hostname)}` : v.src;
}

export function Video({ video }: { readonly video: VideoData }) {
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLIFrameElement & HTMLVideoElement>(null);
  useEffect(() => { if (playing) player.current?.focus(); }, [playing]);
  const name = NAMES[video.provider];
  const link = (
    <a className="kb-bb-video-link" href={video.url} rel={REL} referrerPolicy="no-referrer">{labelOf(video.url)}</a>
  );
  if (playing) {
    return (
      <div className="kb-bb-video" data-provider={video.provider}>
        {video.provider === 'file' ? (
          <video ref={player} className="kb-bb-video-player" src={video.src} controls preload="none" tabIndex={-1} />
        ) : (
          <iframe
            ref={player}
            className="kb-bb-video-player"
            data-provider={video.provider}
            src={frameSrc(video)}
            title={`${name} video`}
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="fullscreen; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer"
            loading="lazy"
            tabIndex={-1}
          />
        )}
        <p className="kb-bb-video-from" data-kb-quotable="hidden">{link}</p>
      </div>
    );
  }
  return (
    <div className="kb-bb-video" data-provider={video.provider}>
      <div className="kb-bb-video-box">
        {video.provider === 'youtube' && (
          <img className="kb-bb-video-thumb" src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" />
        )}
        <div className="kb-bb-video-face" data-kb-quotable="hidden">
          {video.provider !== 'youtube' && <span>▶ {name} video: {labelOf(video.url)}</span>}
          <button type="button" className="kb-button kb-bb-video-play" aria-label={`Play ${name} video`} onClick={() => setPlaying(true)}>
            Play
          </button>
        </div>
      </div>
      <p className="kb-bb-video-from" data-kb-quotable="hidden">{link}</p>
    </div>
  );
}
