/**
 * The instance's emails as the glass-mail plan's Task 6 shows them: each Mail rendered by the engine's `renderHtml` in
 * Divided World's `mailTheme`, into an `<iframe srcdoc>` 600 wide and again at 320 (the design's section 3 width).
 * The sign-in and sign-up emails are the engine's own (engine/mail/auth.ts); the hidden-post email is a fixture in
 * the mockup's stand-in words (docs/research/2026-11-07-mail/02-hidden-post.html), here only to show the facts, quote
 * and button blocks, since the conduct plan writes the real one.
 *
 * The shell demands https URLs for its images and fonts, and Storybook is served over http, so the HTML is rendered
 * with the deployed URLs and the deployed prefix is then swapped for the story's own `/mail/` (Storybook's static
 * `instances/divided-world/ui/public`, .storybook/main.ts). "Images off" renders the four images with URLs that never resolve (`.invalid` is reserved), which is what a client that
 * blocks remote images shows; the fonts still load.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { signIn, signUp } from '../../../engine/mail/auth.ts';
import { renderHtml } from '../../../engine/mail/render.ts';
import type { Mail, MailTheme } from '../../../engine/mail/types.ts';
import { mailTheme } from '../mail/index.ts';

const SAMPLE = { code: '482915', link: 'https://dw.gripe/auth/sample-link' };

/** The mockup's hidden-post email, in its stand-in words. */
const hiddenPost: Mail = {
  subject: 'An admin hid one of your posts',
  preheader: 'Edit it and it comes back.',
  blocks: [
    { type: 'heading', text: 'An admin hid one of your posts' },
    { type: 'paragraph', text: 'A person, not the game, read this post and hid it because it broke the code of conduct. Your words are kept. Edit the post and it comes back.' },
    { type: 'facts', rows: [
      ['Thread', 'Who keeps reacting Salty to my Promos?'],
      ['Rule', '1. The mask is fair game; the person isn’t.'],
      ['Note', 'The last line is about their job, not their character. Cut it and the rest can stand.'],
    ] },
    { type: 'quote', label: 'Your post', words: 'Bold words from a mask who’s been Salty since the day the board opened. Maybe stick to your day job at the…' },
    { type: 'button', label: 'Edit the post', href: 'https://dw.gripe/b/general/sample-post' },
    { type: 'note', text: 'Think the admin got it wrong? Reply to this email and a person will read it.' },
  ],
};

const MAILS = {
  'sign-in': () => signIn(mailTheme, SAMPLE),
  'sign-up': () => signUp(mailTheme, SAMPLE),
  'hidden-post': () => hiddenPost,
} as const;

const DEPLOYED = 'https://dw.gripe/mail/';
const OFF = 'https://images-off.invalid/mail/';

/** The theme with every asset URL (the fonts stay: a client that blocks remote images still loads them) moved to `to`. */
const rebased = (t: MailTheme, to: string): MailTheme => {
  const re = (u: string) => u.replace(DEPLOYED, to);
  return {
    ...t,
    assets: { smoke: re(t.assets.smoke), cutPanel: re(t.assets.cutPanel), cutButton: re(t.assets.cutButton), coin: re(t.assets.coin) },
  };
};

interface Props { readonly mail: keyof typeof MAILS; readonly images: boolean }

function MailFrames({ mail, images }: Props) {
  const html = useMemo(() => {
    const m = MAILS[mail]();
    const out = renderHtml(rebased(mailTheme, images ? DEPLOYED : OFF), m, { slots: [] });
    return out.split(DEPLOYED).join('/mail/');
  }, [mail, images]);
  return (
    <div style={{ padding: 16, background: '#fff', color: '#111', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>The {mail} email, images {images ? 'on' : 'off'}</h1>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {[600, 320].map((width) => (
          <figure key={width} style={{ margin: 0 }}>
            <figcaption style={{ marginBottom: 6 }}>{width} wide</figcaption>
            <iframe title={`The ${mail} email at ${width} wide`} srcDoc={html} width={width} height={900} style={{ border: '1px solid #888' }} />
          </figure>
        ))}
      </div>
    </div>
  );
}

const meta: Meta<typeof MailFrames> = {
  title: 'Mail/Emails',
  component: MailFrames,
  args: { images: true },
  /* The sweep reads this: jsdom cannot address a frame to axe, so the frame's contents are left to e2e/mail.spec.ts (its title is still checked). */
  parameters: { a11y: { frames: false } },
  argTypes: { images: { control: 'boolean', description: 'Off swaps the four image URLs for ones that never resolve (the fonts stay)' }, mail: { table: { disable: true } } },
};
export default meta;

type Story = StoryObj<typeof MailFrames>;

export const SignIn: Story = { args: { mail: 'sign-in' } };
export const SignUp: Story = { args: { mail: 'sign-up' } };
export const HiddenPost: Story = { args: { mail: 'hidden-post' } };
