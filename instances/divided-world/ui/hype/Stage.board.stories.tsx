/**
 * The stage a hype-video shot is filmed on (tools/hype/; docs/plans/2026-11-14-hype-video-storyboard.md; docs/plans/2026-11-21-commentary-video-plan.md): a small world of its own on the
 * fake (stage-world.ts), drawn as the app draws it, with the fake handed to the page as `window.__kbStage`, so a shot script can play the parts of the
 * other players while the camera runs (land a Whoops! on the post, wash a coat as its author, react as a Heel's audience) the way the other board stories hand their
 * probes over. Only the end-to-end build's story route and Storybook draw it; the app exposes nothing.
 *
 * The cast is the film's own (FILM_CAST in stage-world.ts): five made-up names, classes and avatars, copied from the Front Door's five
 * (instances/divided-world/ui/front-door.ts). The film moves to Hotel Bro in #1006's build. The thread is written for the video: a sincere post about a sprite sheet, and what a
 * board does to one. The sheet is the owner's own (wiggler-sheet.gif, his first submission, from 2005), named in the post by an https
 * address the camera answers (tools/hype/stage.mjs), since a post shows a picture from nowhere else.
 *
 * The address dresses the stage: `skin=<theme key>` is the forum skin, as the player's own preference (`default` when absent), and
 * `as=<a character's name>` signs in that character's player in place of Snuckles's and makes that character the one the HUD plays, and `view=` picks the screen (`VIEW`). Tips are off and motion is full, always: the
 * film's player has met every card, and the film is of the motion.
 *
 * The page is drawn inside the camera (Camera.tsx), plain at rest and turned in space when a shot turns it, with the commentary's nodes over it (Nodes.tsx; none until a shot hangs one).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { applyAppearance } from '../../../../engine/ui/appearance.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { LoadedIndex, LoadedProfile, LoadedThread } from '../../../../engine/ui/loaded.tsx';
import type { World } from '../../../../engine/ui/story.tsx';
import { packStroke } from '../../cards/whoops/points.ts';
import { BRUSH_PX, brushOf } from '../../cards/whoops/scrub.ts';
import { Camera, levelBoard, turnBoard } from './Camera.tsx';
import { Nodes, nodes } from './Nodes.tsx';
import { playbook, type Playbook } from './stage-play.ts';
import { buildStage, type Made } from './stage-world.ts';

interface Stage extends Made {
  readonly fake: Fake;
  readonly whoops: { readonly packStroke: typeof packStroke; readonly brushOf: typeof brushOf; readonly BRUSH_PX: number };
  /** What the other players do while the camera runs (stage-play.ts). */
  readonly play: Playbook;
  /** The commentary's nodes (Nodes.tsx). */
  readonly nodes: typeof nodes;
  /** The turn in space (Camera.tsx). */
  readonly camera: { readonly turn: typeof turnBoard; readonly level: typeof levelBoard };
  /** Shows another screen of the stage in place (`thread`, `thread:<key>`, `index`, `profile:<key>`), drawn afresh from what the fake holds now: a navigation without a reload, so what was played stays played. */
  readonly show: (view: string) => void;
  /** Puts another skin on the page in place, as the player's own preference (`skin('midnight')`), for a stretch of a take that reads better in it. */
  readonly skin: (key: string) => Promise<void>;
}
declare global { interface Window { __kbStage?: Stage } }

let made: Made | null = null;

const ASKED = new URLSearchParams(globalThis.location?.search ?? '');
/** Which screen the stage shows: `thread` (the sprite sheet thread), `thread:<key>` (another of its threads), `index`, or `profile:<a staff key or a character's name>`. */
const VIEW = ASKED.get('view') ?? 'thread';

const world: World = (fake, instance) => {
  made = buildStage(fake, instance, {
    skin: ASKED.get('skin') ?? 'default',
    as: ASKED.get('as'),
    view: VIEW,
    /*
     * Whether Snuckles's first post shows its sprite sheet. Only a film asks for it (`sheet=1`): the picture's address is answered by the
     * camera and by nothing else, so a story opened without one (Storybook, the accessibility sweeps) names no address it would have to fetch.
     */
    sheet: ASKED.get('sheet') === '1',
  });
};

function Staged() {
  const { api, ui, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState<{ readonly view: string; readonly epoch: number }>({ view: VIEW, epoch: 0 });
  useEffect(() => {
    let live = true;
    if (made) void made.ready.then(() => { if (live) setReady(true); }, (e: unknown) => { console.error('the stage could not be set', e); });
    return () => { live = false; };
  }, []);
  /*
   * The skin goes on the page as the app puts a player's on (the app's own shell does this; a story has no shell), and then its sheet is
   * moved to the end of the head. A story's page carries the house theme in its own bundle (.storybook/preview.tsx imports it), which
   * lands after the theme's link, so the house theme won every token the two share: a skin showed its own extras over the house's
   * colors (Fan Site's film strip on the house's dark gray, where its page is blue). In the app the skin's sheet is the only theme.
   */
  useEffect(() => {
    if (!ready) return;
    void api.preferences().then((p) => {
      applyAppearance(document, p, ui.themes, ui.glass);
      const sheet = document.querySelector('link#kb-theme');
      if (sheet) document.head.append(sheet);
    });
  }, [api, ui, ready]);
  useEffect(() => {
    if (!made || !ready) return;
    window.__kbStage = { ...made, fake: api as Fake, whoops: { packStroke, brushOf, BRUSH_PX }, play: playbook(api as Fake, instance, made), nodes, camera: { turn: turnBoard, level: levelBoard }, show: (view) => { setShown((s) => ({ view, epoch: s.epoch + 1 })); }, skin: async (key) => { await api.setPreferences({ theme: key }); applyAppearance(document, await api.preferences(), ui.themes, ui.glass); const sheet = document.querySelector('link#kb-theme'); if (sheet) document.head.append(sheet); } };
    return () => { delete window.__kbStage; nodes.clear(); };
  }, [api, instance, ready]);
  if (!made || !ready) return <Frame><div aria-busy="true" /></Frame>;
  const [view, of = ''] = shown.view.split(':');
  return (
    <Camera>
      <Frame key={shown.epoch}>
        {view === 'index' ? <LoadedIndex /> : view === 'profile' ? <LoadedProfile id={made.staff[of] ?? made.cast[of] ?? ''} /> : <LoadedThread thread={made.threads[of || 'main'] ?? made.thread} />}
      </Frame>
      <Nodes />
    </Camera>
  );
}

const meta: Meta<typeof Staged> = {
  /* Under Boards, as every story the end-to-end build's story route serves is (web/src/data/fixtures/stories.test.tsx holds their ids to it). */
  title: 'Boards/Hype stage',
  component: Staged,
  parameters: { world, layout: 'fullscreen' },
};
export default meta;

export const Main: StoryObj<typeof Staged> = {};
