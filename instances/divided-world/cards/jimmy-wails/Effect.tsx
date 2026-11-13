/**
 * Jimmy Wails's effect on a post (docs/plans/2026-11-03-jimmy-wails-design.md, sections 4, 6 and 7; plan Task 7): the post's words unchanged, then,
 * below them, the latest drive's banners as a carousel with its drive under them (Drive.tsx). An earlier, closed drive is a collapsed line, "An earlier
 * drive raised 3.10 in 7 gifts", that opens its banners.
 *
 * **The carousel** shows one banner at a time, all stacked so one fades into the next. It advances every 8 seconds and pauses while the pointer is over
 * it, while focus is in it and from its pause button. Under reduced motion it never advances by itself and swaps with no fade, and previous and next
 * move it either way. Previous, next, a dot for each banner and "1 of 3" say where it stands. The photograph's credit is drawn once, under the slides, for
 * the banner on view. A drive with one banner is the banner alone.
 *
 * **Where it shows.** In a thread the drive has its buttons; in the ORIGIN box of a thread spun from the post, and in a play's moment (`still`: nothing
 * in a moment takes input or advances), the banners and the totals show and the buttons do not.
 *
 * The amounts and the overhead are the economy's (`settings.cardEconomy` over the instance's own, the card's `reads`); a key the economy
 * lacks throws (economyOf) rather than show a price the server would refuse.
 */
import { useEffect, useState, type FocusEvent } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import type { CardPlay, Drive as DriveOf, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { economyOf } from '../../../../engine/rules/cards.ts';
import { withCardEconomy } from '../../../../engine/ui/cards/faces.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { Banner, Credit } from './Banner.tsx';
import { Drive, raisedWords } from './Drive.tsx';
import './jimmy-wails.css';

/** How long a banner stays before the carousel moves on by itself. */
export const ADVANCE_MS = 8000;

const GIFT_KEYS = ['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4'] as const;

export interface CarouselProps {
  readonly plays: readonly CardPlay[];
  readonly nameOf: EffectProps['nameOf'];
  /** True where nothing moves by itself (a play's moment). */
  readonly still?: boolean;
}

export function Carousel({ plays, nameOf, still = false }: CarouselProps) {
  const reduced = useMotionReduced();
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [within, setWithin] = useState(false);
  const [held, setHeld] = useState(false);
  const n = plays.length;
  const at = Math.min(index, Math.max(0, n - 1));
  const advancing = n > 1 && !reduced && !still && !held && !hover && !within;

  useEffect(() => {
    if (!advancing) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % n), ADVANCE_MS);
    return () => clearInterval(timer);
  }, [advancing, n, at]);

  if (n === 0) return null;
  if (n === 1) return <Banner play={plays[0]!} caster={nameOf(plays[0]!.caster)} />;

  const step = (by: number) => setIndex((at + by + n) % n);
  const leaving = (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget)) setWithin(false); };
  return (
    <section
      className="dw-jw-carousel" aria-roledescription="carousel" aria-label="Appeals" data-reduced={reduced ? 'true' : undefined}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setWithin(true)} onBlur={leaving}
    >
      <div className="dw-jw-slides" aria-live={advancing ? 'off' : 'polite'}>
        {plays.map((play, i) => (
          <div
            key={play.id} className="dw-jw-slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`}
            data-active={i === at ? 'true' : 'false'} aria-hidden={i === at ? undefined : true} inert={i === at ? undefined : true}
          >
            <Banner play={play} caster={nameOf(play.caster)} credited={false} />
          </div>
        ))}
      </div>
      <Credit play={plays[at]!} />
      <div className="dw-jw-controls">
        <button type="button" className="dw-jw-step" aria-label="Previous appeal" onClick={() => step(-1)}>&lsaquo;</button>
        <span className="dw-jw-dots">
          {plays.map((play, i) => (
            <button key={play.id} type="button" className="dw-jw-dot" aria-label={`Show appeal ${i + 1}`} aria-current={i === at ? 'true' : undefined} onClick={() => setIndex(i)} />
          ))}
        </span>
        <button type="button" className="dw-jw-step" aria-label="Next appeal" onClick={() => step(1)}>&rsaquo;</button>
        <span className="dw-jw-count">{at + 1} of {n}</span>
        {reduced || still ? null : <button type="button" className="dw-jw-pause" aria-label="Pause rotation" aria-pressed={held} onClick={() => setHeld((h) => !h)}>{held ? 'Resume' : 'Pause'}</button>}
      </div>
    </section>
  );
}

export function JimmyWailsEffect({ post, drives, place, still, nameOf, give, moreGifts, wallet, children }: EffectProps) {
  const { instance, settings } = useKayfa();
  const list = drives ?? [];
  const latest = list.at(-1);
  const earlier = list.slice(0, -1);
  const priced = withCardEconomy(instance.settings, settings.cardEconomy);
  const amounts = GIFT_KEYS.map((key) => economyOf(priced, key));
  const overhead = economyOf(priced, 'jimmyWails.overhead');
  const author = nameOf(post.character);
  const common = { author, amounts, overhead, buttons: place === 'thread' && !still, wallet, give, moreGifts, nameOf } as const;
  const driveOf = (d: DriveOf) => <Drive key={d.id} drive={d} {...common} />;

  return (
    <>
      {children}
      {latest ? (
        <aside className="dw-jw" aria-label="Donation drive">
          <Carousel plays={latest.plays} nameOf={nameOf} still={still} />
          {driveOf(latest)}
          {earlier.map((d) => (
            <details key={d.id} className="dw-jw-earlier">
              <summary>An earlier drive raised {raisedWords(d.total, d.count)}</summary>
              <Carousel plays={d.plays} nameOf={nameOf} still={still} />
            </details>
          ))}
        </aside>
      ) : null}
    </>
  );
}
