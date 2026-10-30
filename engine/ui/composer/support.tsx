/**
 * What the composer's and the spin form's tests share: a thread on the in-memory backend with a
 * player who plays two characters, and a pair of buttons that swap the HUD's character the way the
 * HUD does (a test in engine/ui may not import the HUD's screen parts or an instance).
 */
import { screen } from '@testing-library/react';
import type { Id } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { usePlayer } from '../player.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';

/** Pipewrench and Zed are the signed-in player's (Pipewrench first, so the HUD starts there); Spritey is another player's. */
export function threadWorld(posts = 2, settings: Parameters<typeof buildWorld>[0] = undefined) {
  const fake = buildWorld(settings);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const zed = fake.seed.character(me, 'Zed', 'face');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'A short thread', 'post 1');
  const ids = [first];
  for (let i = 2; i <= posts; i++) ids.push(fake.seed.post(thread, i % 2 ? spritey : pipe, `post ${i}`));
  fake.signInAs(me);
  return { fake, me, other, pipe, zed, spritey, thread, ids };
}

/** The buttons a test presses to change the HUD's character. */
export function Swapper() {
  const { actingCharacters, setHudCharacter } = usePlayer();
  return (
    <div>
      {actingCharacters.map((c) => <button key={c.id} type="button" onClick={() => setHudCharacter(c.id)}>Switch to {c.name}</button>)}
    </div>
  );
}

export function openThread(w: { fake: Fake; thread: Id }, path = `/t/${w.thread}`) {
  return renderIn(w.fake, <><ThreadScreen thread={w.thread} /><Swapper /></>, { path });
}

/** The composer's box, once the thread has loaded. */
export const replyBox = () => screen.findByRole('textbox', { name: 'Your reply' });
