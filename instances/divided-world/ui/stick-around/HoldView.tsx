/**
 * Stick Around's full-screen view (screens design, section 10 as amended 2026-10-30): the held post lifted out of its
 * thread into a glass view of its own, on the `effect` smoke, with the thread dimmed and inert behind it (Overlay).
 *
 * The post scrolls inside the view, so a long post is read whole there, and the caster's checkbox stands at its end.
 * In the view's foot are the bar (`progressbar "Break free"`) and a BREAK FREE button. Only scrolling pushed past an end
 * of the post fills the bar (hold.ts, `pushPastEnd`), counted by the distance it would have scrolled, so wheel, touch,
 * trackpad and the keyboard's scrolling keys all count alike; the bar drains at a constant rate (`barStep`). A full bar
 * frees the reader for this visit, on the side they were pushing toward. The button fills it by presses against the same
 * drain, so the way for a keyboard or a screen reader costs about what scrolling does.
 *
 * It is a dialog with no Close: its ways out are the bar, the checkbox, and leaving the page, and it says so. Esc, which
 * would otherwise close it, answers with those words, since an Esc that closed it would be a free way out.
 */
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type TouchEvent, type WheelEvent } from 'react';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { Overlay } from '../../../../engine/ui/glass/Overlay.tsx';
import { when } from '../../../../engine/ui/thread/lines.tsx';
import { stickAround } from '../../cards/stick-around.ts';
import type { HoldStageValue } from './Effect.tsx';
import { barStep, countPresses, FULL, pushPastEnd } from '../../cards/stick-around/hold.ts';

/** What a scrolling key scrolls by, as the browser would: a line of arrows, or most of a screen for a page. */
const ARROW = 48;
const PAGE = 0.9;

const WAYS_OUT = 'Scroll past either end of the post, press Break free, or check the box.';

const sentenceOf = (play: CardPlay): string => {
  const given = stickAround.validateConfig(play.config);
  return given.ok ? given.value.sentence : (stickAround.validateConfig({}) as { value: { sentence: string } }).value.sentence;
};

interface Props {
  readonly post: Act;
  readonly play: CardPlay;
  readonly stage: HoldStageValue;
  readonly release: EffectProps['release'];
  /** The bar filled: the reader is free for this visit; `pushed` is the last push's direction (positive down). */
  readonly onBreakFree: (pushed: number) => void;
  readonly children: ReactNode;
}

export function HoldView({ post, play, stage, release, onBreakFree, children }: Props) {
  const { api } = useKayfa();
  const frozen = stage.mode === 'view';
  const [level, setLevel] = useState(stage.mode === 'view' ? stage.level : 0);
  const [names, setNames] = useState<{ author: string; caster: string }>({ author: 'A character', caster: 'A character' });
  const [checked, setChecked] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [nudged, setNudged] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const touchY = useRef<number | null>(null);
  /* What the reader has done since the last frame, and where the bar has got to: read by the frame loop, written by events. */
  const input = useRef({ pushed: 0, lastPush: 1, presses: [] as number[], lastCounted: -Infinity });
  const told = useRef(onBreakFree);
  told.current = onBreakFree;
  const id = useId();

  useEffect(() => {
    const ids = [post.character, play.caster].filter((c): c is string => c !== null);
    void api.characters(ids).then((found) => {
      const name = (c: string | null) => found.find((f) => f.id === c)?.name ?? 'A character';
      setNames({ author: name(post.character), caster: name(play.caster) });
    }, () => { /* the names are decoration; the view stands without them */ });
  }, [api, post.character, play.caster]);

  /* A staged view may start partway through a long post. */
  useEffect(() => {
    const el = scroller.current;
    if (el && stage.mode === 'view' && stage.scrolled !== undefined) el.scrollTop = (el.scrollHeight - el.clientHeight) * stage.scrolled;
  }, [stage]);

  /* The frame loop: each frame steps the bar by what came in, and frees the reader when it is full. */
  useEffect(() => {
    if (frozen) return;
    let frame = 0;
    let last = performance.now();
    let at = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      /* A frame of no time counts nothing, so what came in waits for the next. */
      if (dt > 0) {
        last = now;
        const i = input.current;
        const counted = countPresses(i.presses, i.lastCounted);
        at = barStep(at, { push: i.pushed, screen: scroller.current?.clientHeight ?? window.innerHeight, presses: counted.counted }, dt);
        i.lastCounted = counted.lastCountedMs;
        i.pushed = 0;
        i.presses = [];
        setLevel(at);
        if (at >= FULL) { told.current(i.lastPush); return; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [frozen]);

  /* A scroll the reader asked for, in pixels (positive down): the post takes what it can, and the rest is pushed past its end. */
  const asked = useCallback((delta: number, apply: boolean) => {
    const el = scroller.current;
    if (!el || delta === 0 || !Number.isFinite(delta)) return;
    const { offset, push } = pushPastEnd({ offset: el.scrollTop, max: el.scrollHeight - el.clientHeight }, delta);
    if (apply) el.scrollTop = offset;
    if (push !== 0) {
      input.current.pushed += Math.abs(push);
      input.current.lastPush = push;
    }
  }, []);

  const onWheel = (e: WheelEvent) => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (scroller.current?.clientHeight ?? 1) : 1;
    asked(e.deltaY * unit, false);
  };
  const onTouchStart = (e: TouchEvent) => { touchY.current = e.touches[0]?.clientY ?? null; };
  const onTouchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY;
    if (y === undefined || touchY.current === null) return;
    asked(touchY.current - y, false);
    touchY.current = y;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const room = scroller.current?.clientHeight ?? 0;
    const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement;
    let delta = 0;
    if (e.key === 'ArrowDown') delta = ARROW;
    else if (e.key === 'ArrowUp') delta = -ARROW;
    else if (e.key === 'PageDown') delta = room * PAGE;
    else if (e.key === 'PageUp') delta = -room * PAGE;
    else if (e.key === ' ' && !onControl) delta = e.shiftKey ? -room * PAGE : room * PAGE;
    if (delta === 0) return;
    /* A focused control would scroll nothing, so the key is answered here, as the focused post would have answered it. */
    e.preventDefault();
    asked(delta, true);
  };

  const press = (e: { timeStamp: number }) => { input.current.presses.push(e.timeStamp); };

  const certify = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.checked) return;
    setChecked(true);
    setRefused(null);
    const done = await release(play.id);
    if (!done.ok) { setChecked(false); setRefused(done.error); }
  };

  /* Esc, or a press on the dimmed page behind: no way out, and it says which are. */
  const hint = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudge = () => {
    setNudged(true);
    if (hint.current !== null) clearTimeout(hint.current);
    hint.current = setTimeout(() => setNudged(false), 3500);
  };
  useEffect(() => () => { if (hint.current !== null) clearTimeout(hint.current); }, []);

  const percent = Math.round(Math.min(Math.max(level, 0), FULL) * 100);
  const heading = `Held post: ${names.author}${post.seq === null ? '' : `, #${post.seq}`}`;
  const sentence = sentenceOf(play);
  const why = `${id}-why`;
  return (
    <Overlay
      title="Stick Around" label="Stick Around" className="kb-hold-view" surface="effect" closeAt="none" onClose={nudge}
      aside={<p className="kb-hold-tag"><span className="kb-calm">{names.caster}{play.message ? `: “${play.message}”` : ''}</span></p>}
    >
      <div className="kb-hold-inner" onWheel={onWheel} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onKeyDown={onKeyDown}>
        <div ref={scroller} className="kb-hold-scroll" tabIndex={0} role="region" aria-label="The held post, and how to be released from it">
          <article className="kb-hold-post" aria-label={heading}>
            <header className="kb-hold-post-line">
              <b>{names.author}</b>
              <span><time dateTime={post.createdAt}>{when(post.createdAt)}</time> {post.seq !== null && ` · #${post.seq}`}</span>
            </header>
            <div className="kb-hold-post-body">{children}</div>
          </article>
          <section className="kb-hold-release" aria-label="Release">
            <label className="kb-hold-check kb-glass-cut-panel">
              <input type="checkbox" checked={checked} onChange={(e) => { void certify(e); }} />
              <span>
                <span className="kb-hold-check-head">Check to be released</span>
                <span className="kb-hold-check-words">{sentence}</span>
              </span>
            </label>
            {refused && <p role="alert" className="kb-hold-refused">{refused}</p>}
          </section>
        </div>
        <div className="kb-hold-foot">
          <div className="kb-hold-bar kb-glass-cut-panel">
            <div className="kb-hold-bar-head"><span>Break free</span><span aria-hidden="true">{percent}%</span></div>
            <div className="kb-hold-track" role="progressbar" aria-label="Break free" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%`}>
              <div className="kb-hold-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="kb-hold-hint">
              Keep scrolling away to break free for this visit. Next visit, it holds you again until you check.
            </p>
          </div>
          <button type="button" className="kb-hold-button kb-glass-cut-button" onClick={press} aria-describedby={why}>Break free</button>
          <p id={why} className="kb-visually-hidden">Press it again and again to fill the bar, as fast scrolling does. The bar drains whenever you stop.</p>
        </div>
        <p className="kb-hold-ways" role="status">{nudged ? `Esc does not close this. ${WAYS_OUT}` : ''}</p>
      </div>
    </Overlay>
  );
}
