import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BbCode } from './render.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
import { RouterProvider } from '../router.tsx';

const show = (text: string) => render(<RouterProvider><div data-testid="out"><BbCode text={text} /></div></RouterProvider>);
const out = () => screen.getByTestId('out');
const ID = 'dQw4w9WgXcQ';

describe('a video in a post', () => {
  test('shut: no frame, a Play button, the address as a link, YouTube\'s thumbnail by its fixed address', () => {
    show(`[video]https://youtu.be/${ID}[/video]`);
    expect(out().querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play YouTube video' })).toBeInTheDocument();
    expect(out().querySelector('img')).toHaveAttribute('src', `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `https://youtu.be/${ID}`);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  test('another provider\'s box is a plain label and loads nothing', () => {
    show('[video]https://vimeo.com/123[/video]');
    expect(out().querySelector('img')).toBeNull();
    expect(out().querySelector('iframe')).toBeNull();
    expect(out()).toHaveTextContent('▶ Vimeo video: vimeo.com/123');
  });

  test('Play swaps in a sandboxed frame at the player address and moves focus to it', () => {
    show(`[youtube]${ID}[/youtube]`);
    fireEvent.click(screen.getByRole('button', { name: /Play/u }));
    const frame = out().querySelector('iframe') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', `https://www.youtube-nocookie.com/embed/${ID}`);
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).toHaveAttribute('loading', 'lazy');
    expect(frame).toHaveAttribute('allow', 'fullscreen; encrypted-media');
    expect(frame).toHaveAttribute('title', 'YouTube video');
    expect(document.activeElement).toBe(frame);
    expect(screen.getByRole('link')).toHaveAttribute('href', `https://youtu.be/${ID}`);
  });

  test('Twitch\'s frame is told the page\'s own host', () => {
    show('[video]https://clips.twitch.tv/Abc-1[/video]');
    fireEvent.click(screen.getByRole('button', { name: /Play/u }));
    expect(out().querySelector('iframe')).toHaveAttribute('src', `https://clips.twitch.tv/embed?clip=Abc-1&parent=${location.hostname}`);
  });

  test('a file is a native video that preloads nothing, and takes focus', () => {
    show('[video]https://cdn.example.com/a.mp4[/video]');
    expect(out().querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Play/u }));
    const v = out().querySelector('video') as HTMLVideoElement;
    expect(v).toHaveAttribute('src', 'https://cdn.example.com/a.mp4');
    expect(v).toHaveAttribute('preload', 'none');
    expect(v.controls).toBe(true);
    expect(document.activeElement).toBe(v);
  });

  test('a URL no provider covers stays the words written', () => {
    show('[video]https://example.com/page[/video]');
    expect(out().textContent).toBe('[video]https://example.com/page[/video]');
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('axe finds nothing, shut or playing (a file; axe cannot enter jsdom\'s frames, so a frame is held by the attribute tests above)', async () => {
    show(`[video]https://youtu.be/${ID}[/video][video]https://soundcloud.com/a/b[/video][video]https://cdn.example.com/a.mp4[/video]`);
    expect(describeViolations(await axeViolations(out()))).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Play File video' }));
    expect(describeViolations(await axeViolations(out()))).toBe('');
  });
});
