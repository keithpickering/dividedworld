/**
 * A play's panel (docs/plans/2026-10-31-plays-on-a-post-design.md, section 3): what its quiet tag opens. A play
 * is an Act like a post, so it is reacted to and spun from here, on its own: a sharp card can steal its post's thunder
 * (the core-loop design's section 7), and "outdraws" its target by the reactions to it.
 *
 * It is the glass's overlay (engine/ui/glass/Overlay.tsx) on the `effect` smoke, in its card's ink or alignment for
 * its border and glow, chamfered: a popover beside the tag on a desktop and a bottom sheet at the thread's narrow
 * width. It takes focus, closes on Esc, its Close, or a press outside it, and gives focus back to what opened it. It
 * holds the card's name, who played it and when, the caster's words, the card's own line about the play on this
 * screen (`Plays.note`), the play's reactions with React (the post's, for the play's Act; a play by one of the
 * reader's own characters shows no React, decided on the reader's screen from their own characters), Spin thread,
 * the threads spun from it, and Go to post. It reads nothing new when it opens: the reactions and the spins were read
 * with the page (thread/Thread.tsx `prepare`), so the panel costs nothing at a busy instance's scale.
 */
import { useRef, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { Overlay } from '../glass/Overlay.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import type { Mine } from '../reactions/mine.ts';
import { Link } from '../router.tsx';
import { useSpunInto, spunCount } from '../spin/spun.ts';
import { when } from '../thread/lines.tsx';
import type { Tallies } from '../thread/tallies.ts';
import { useNote, type Plays } from './plays.ts';
import type { CardPlay } from './types.ts';
import './panel.css';

/** A play's name, as its panel is named and the spin form says it: "Mrs. Hooligan's Whoops!". */
export const playName = (caster: string, card: string): string => `${caster}'s ${card}`;

export interface PlayPanelProps {
  readonly play: CardPlay;
  readonly caster: string;
  /** The card's ink for the panel's border and glow, where the card chose one (`CardUi.tag`). */
  readonly tint?: string;
  /** The plays store the card's note is read from; none where the play is in none (a card spun from, in its ORIGIN box). */
  readonly plays?: Plays;
  readonly tallies: Tallies;
  readonly mine: Mine;
  /** The post the play landed on, where Go to post leads; none where it cannot be found. */
  readonly to: string | null;
  /** The phone's bottom sheet, and not the popover. */
  readonly sheet: boolean;
  /** What opened the panel, which it stands beside on a desktop and gives focus back to. */
  readonly opener: HTMLElement;
  /** Where focus goes when the opener is gone by the time the panel closes (its tag gone with a read of the page): the stack's button, or its top tag. */
  readonly fallback?: () => HTMLElement | null;
  readonly onClose: () => void;
  /** Spin a thread from the play: the panel closes, and the post's spin form opens with the play as its origin. */
  readonly onSpin: (play: CardPlay, name: string) => void;
}

function Note({ plays, play }: { readonly plays: Plays; readonly play: CardPlay }) {
  const note = useNote(plays, play.post, play.id);
  return note ? <p className="kb-play-panel-note">{note}</p> : null;
}

function Spun({ play }: { readonly play: Id }) {
  const spun = useSpunInto(play);
  const n = spunCount(spun);
  if (n === 0) return null;
  return (
    <div className="kb-play-panel-spun">
      <p>{n === 1 ? '1 thread' : `${n}${spun.atLeast ? ' or more' : ''} threads`} spun from this play</p>
      <ul>
        {spun.threads.map((t) => <li key={t.id}><Link to={`/t/${t.id}`}>{t.title}</Link></li>)}
      </ul>
      {spun.more > 0 && <p>and {spun.more}{spun.atLeast ? ' or more' : ''} more</p>}
    </div>
  );
}

export function PlayPanel({ play, caster, tint, plays, tallies, mine, to, sheet, opener, fallback, onClose, onSpin }: PlayPanelProps) {
  const { instance } = useKayfa();
  const rules = instance.cards.find((c) => c.key === play.card);
  const card = rules?.name ?? play.card;
  const name = playName(caster, card);
  /* The overlay opens by the tag on a desktop; at the narrow width it is a sheet whatever the window's room. */
  const anchor = useRef<HTMLElement | null>(opener);
  anchor.current = opener;
  return (
    <Overlay
      title={card} label={`${card} by ${caster}`} surface="effect" anchor={anchor} sheetBelow={sheet ? Number.POSITIVE_INFINITY : 0}
      onClose={onClose} returnFocusTo={() => (opener.isConnected ? opener : fallback?.() ?? null)} className="kb-play-panel"
      style={tint ? { '--kb-tag': tint } as CSSProperties : undefined}
      data={{ 'kb-panel': sheet ? 'sheet' : 'popover', 'kb-card': play.card, 'kb-alignment': rules?.alignment, 'kb-tinted': tint ? 'true' : undefined, 'kb-play': play.id }}
    >
      <p className="kb-play-panel-by"><span className="kb-play-panel-who kb-glass-display">{caster}</span> · played <time dateTime={play.playedAt}>{when(play.playedAt)}</time></p>
      {play.message && <blockquote className="kb-play-panel-message">“{play.message}”</blockquote>}
      {plays && <Note plays={plays} play={play} />}
      <Reactions act={play.id} author={play.caster} authorName={caster} subject={name} tallies={tallies} mine={mine} look="glass" />
      <div className="kb-play-panel-actions">
        <button type="button" className="kb-glass-cut-button kb-play-panel-action" onClick={() => onSpin(play, name)}>Spin thread</button>
        {to && <Link className="kb-glass-cut-button kb-play-panel-action" to={to}>Go to post</Link>}
      </div>
      <Spun play={play.id} />
    </Overlay>
  );
}
