/**
 * The Cards board's hand sheet (docs/research/2026-10-29-two-worlds/05-cards.html, 1440 by 1080) as a
 * story, on the board's own canvas, so the board match (e2e/boards/05-cards.ts) reads it through the
 * end-to-end build's story route beside the board. It is the left of the board: the heading, the
 * player's cards as the sheet draws them (large, rotated a few degrees, each with its name, its
 * price, its rules in plain words and its state tag), the sealed slot, the three state chips, and
 * "On the board, the same card reads like this", a 2003 post carrying the card's tag. The play form
 * on the board's right is the app's, not this story's (cards Task 3).
 *
 * The cards are the signed-in player's hand at the board's moment (the boards fixture's `05-cards`:
 * one Stick Around and two Whoops!), drawn from the instance's own cards and prices. The second card
 * is the armed one, as the board draws it; the story names no card, so which that is falls to the
 * instance's order. Nothing here acts: it is a specimen for the board match and the owner's review.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import { Smoke, useSurfaceStyle } from '../glass/Smoke.tsx';
import { usePlayer } from '../player.tsx';
import { createTallies } from '../thread/tallies.ts';
import { PlayTag } from './Effects.tsx';
import { Postcard } from './Postcard.tsx';
import { facesOf } from './faces.ts';
import type { CardPlay } from './types.ts';
import './hand-board.css';

/** Where the board stands each card, by its place in the hand: its left, its top and how far it turns; the sealed slot stands after the last. */
const PLACES = [{ left: 64, top: 204, turn: -4 }, { left: 372, top: 178, turn: 2 }, { left: 668, top: 204, turn: 5 }] as const;

function HandSheet() {
  const { instance, ui } = useKayfa();
  /* The tag's reactions: none, as a specimen that nothing has reacted to. */
  const tallies = useMemo(() => createTallies(), []);
  const { cards } = usePlayer();
  const calm = useSurfaceStyle('hand');
  const faces = useMemo(() => facesOf(instance.cards, ui.cards, instance.settings), [instance, ui.cards]);
  const held = faces.filter((f) => (cards.find((c) => c.card === f.key)?.held ?? 0) > 0);
  const count = cards.reduce((n, c) => n + c.held, 0);
  /* The armed card is the second in the hand, as the board draws it. */
  const armed = held[1] ?? null;
  const shown = armed ?? held[0] ?? null;
  /* The play whose tag the board's post carries: the armed card's, by Mrs. Hooligan. */
  const play: CardPlay | null = shown && {
    id: 'play-41', card: shown.key, layer: 1, caster: null, message: 'you dropped your ink', config: {}, playedAt: '2026-10-29T21:16:00Z', post: 'post-41',
  };
  return (
    <div className="kb-glass kb-hand-board" style={calm}>
      <Smoke surface="hand" />
      <header className="kb-hand-board-head">
        <p className="kb-hand-board-eyebrow kb-calm">Your hand · {count} {count === 1 ? 'card' : 'cards'}</p>
        <h1 className="kb-hand-board-title kb-glass-display">Postcards</h1>
      </header>

      {held.map((face, i) => {
        const isArmed = armed?.key === face.key;
        const at = PLACES[Math.min(i, 1)]!;
        const says = `kb-hand-board-says-${face.key}`;
        return (
          <div key={face.key} className="kb-hand-board-card" style={{ left: at.left, top: at.top, transform: `rotate(${at.turn}deg)` }}>
            <Postcard as="article" face={face} size="sheet" armed={isArmed} aria-label={`${face.name}, a ${face.tag} postcard${isArmed ? ', armed' : ''}`} aria-describedby={says} />
            <span id={says} className="kb-visually-hidden">{face.describe}</span>
          </div>
        );
      })}

      <article className="kb-hand-board-sealed" aria-label="An empty slot for a future postcard" style={{ left: PLACES[2].left, top: PLACES[2].top, transform: `rotate(${PLACES[2].turn}deg)` }}>
        <span className="kb-hand-board-mark" aria-hidden="true">?</span>
        <h2 className="kb-hand-board-sealed-head kb-glass-display kb-calm">Sealed</h2>
        <p className="kb-hand-board-sealed-says kb-calm">A slot in the Vending Machine waiting for the next postcard.</p>
      </article>

      <div className="kb-hand-board-chips kb-calm">
        <span className="kb-hand-board-chip" data-kb-chip="held">In hand</span>
        <span className="kb-hand-board-chip" data-kb-chip="armed">Armed · pick a post</span>
        <span className="kb-hand-board-chip" data-kb-chip="later">Coming later</span>
      </div>

      <section className="kb-hand-board-onboard" aria-label="How it reads on the board">
        <p className="kb-hand-board-onboard-head kb-calm">On the board, the same card reads like this</p>
        <div className="kb-hand-board-post">
          <div className="kb-hand-board-post-bar"><span>Spritey · #41</span><span>who keeps splatting my posts</span></div>
          {play && (
            <ul className="kb-play-tags kb-hand-board-tags">
              <li className="kb-play-tags-lead"><PlayTag play={play} caster="Mrs. Hooligan" tallies={tallies} onOpen={() => {}} /></li>
            </ul>
          )}
          <div className="kb-hand-board-post-foot">
            <span className="kb-hand-board-chipline">🔥 4</span><span className="kb-hand-board-chipline">🙄 2</span>
            {shown && <span className="kb-hand-board-play"><span className="kb-hand-board-swatch" aria-hidden="true" />Play {shown.name} here</span>}
          </div>
        </div>
      </section>
    </div>
  );
}

const meta: Meta<typeof HandSheet> = {
  title: 'Boards/05 Cards',
  component: HandSheet,
  /* The board's own moment: the player at 21:51 on Oct 29, with three cards in hand. */
  parameters: { moment: '05-cards', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof HandSheet>;

/** The hand sheet at the board's size: 1440 by 1080. */
export const Sheet: Story = {};
