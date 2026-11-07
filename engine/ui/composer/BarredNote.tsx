/**
 * The box a barred mask's composer holds where the reply box (or New thread's fields) would be (docs/plans/2026-11-06-member-groups-plan.md, Task 10; the mockup's last panel,
 * docs/research/2026-11-06-member-groups/01-bars.html). A conferGroup move that bars a character from a board is a public Act, so the bar is a public fact (`bars_now`, carried by
 * `my_characters.bars`) and nothing private; the one private read is the character's own apology state (`my_apologies`), which the player's own mask alone gets.
 *
 * It is board copy: plain and true about the game's state, never in the staff member's voice (the fiction may lie; the log never does). It names who made the move by the office
 * the move's staff character holds (a Mod may make this move), the group by the instance's name for it, the date of the move and the end of the bar. The way out is the
 * apology: **Write an apology** opens the spin form on the move, sent through `apologize`; while one waits it says whom it is with, and after a rejection it says when the next may
 * be written. **See the move** links to the move's post. The Appeal button is the appeals task's (Task 14) and stands after See the move.
 *
 * The box belongs to the acting character: the composer swaps it away with the mask. A mask that is also banned is told of its ban instead (the composer does not draw this), so
 * no apology is offered while a ban holds.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { officeRole } from '../board/move-words.ts';
import { dayAndTime } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Apology, Bar, Character, Id, MyCharacter } from '../data/api.ts';
import { lowerFirst } from '../copy-words.ts';
import { shortDate } from '../postbit/dates.ts';
import { Link } from '../router.tsx';
import { SpinForm } from '../spin/SpinForm.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import './composer.css';

/** The longest a timer may be set for (setTimeout's cap): a bar longer than that is waited out in as many as it takes. */
const MOST_MS = 2 ** 31 - 1;

/**
 * The bar the character is under on this board now, or null. A bar is a public fact about the character, carried by the player's own characters (`my_characters.bars`) as a ban is,
 * so the composer makes no read of its own; it drops the bar by itself at its end. The server refuses a barred post in its own words all the same (`not_barred`): this is the screen
 * saying so before a reply is written for nothing, and the way out beside it.
 */
export function useBar(character: Pick<MyCharacter, 'bars'> | null, board: Id | null): Bar | null {
  const [ticks, tick] = useState(0);
  const bar = (character?.bars ?? []).filter((b) => b.board === board && (b.expiresAt === null || Date.parse(b.expiresAt) > Date.now()))
    .sort((a, b) => Date.parse(b.expiresAt ?? '9999') - Date.parse(a.expiresAt ?? '9999'))[0] ?? null;
  const until = bar?.expiresAt ?? null;
  useEffect(() => {
    if (until === null) return;
    const left = Date.parse(until) - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, MOST_MS));
    return () => clearTimeout(timer);
  }, [until, ticks]);
  return bar;
}

interface Detail {
  readonly move: Act | null;
  readonly staff: Character | null;
  readonly board: string | null;
  readonly apologies: readonly Apology[];
}

export function BarredNote({ character, bar }: { readonly character: { readonly id: Id; readonly name: string }; readonly bar: Bar }) {
  const head = useId();
  const { api, ui, settings } = useKayfa();
  const [detail, setDetail] = useState<Detail | 'failed' | null>(null);
  const [writing, setWriting] = useState(false);
  const [, tick] = useState(0);
  const write = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    void (async () => {
      const [move, boards, apologies] = await Promise.all([api.act(bar.move), api.boardNames(), api.myApologies(character.id)]);
      const staff = move?.character ? (await api.characters([move.character]))[0] ?? null : null;
      if (live) setDetail({ move, staff, board: boards.find((b) => b.id === bar.board)?.name ?? null, apologies: apologies.filter((a) => a.move === bar.move) });
    })().catch(() => { if (live) setDetail('failed'); });
    return () => { live = false; };
  }, [api, bar.move, bar.board, character.id]);

  /* A rejection's wait ends by itself: the box draws the button again at that time. */
  const waitEnds = detail !== null && detail !== 'failed' ? nextWrittenAt(detail.apologies) : null;
  useEffect(() => {
    if (waitEnds === null) return;
    const left = waitEnds - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, MOST_MS));
    return () => clearTimeout(timer);
  }, [waitEnds]);

  if (detail === null) return <div className="kb-composer kb-barred kb-box" aria-busy="true" />;
  const group = settings.groups.find((g) => g.key === bar.group)?.name ?? bar.group;
  const who = officeRole(ui.copy, detail === 'failed' ? undefined : detail.staff?.office);
  const board = detail === 'failed' ? null : detail.board;
  const boardWords = board ?? 'this board';
  const heading = `${character.name} can't post on ${boardWords} right now.`;
  if (detail === 'failed') {
    return (
      <section className="kb-composer kb-barred kb-box" aria-labelledby={head}>
        <h2 className="kb-barred-head" id={head}>{heading}</h2>
        <p className="kb-notice" data-kb-tone="refusal">{character.name} is in {group}, which can't post here. The rest could not be loaded. Reload the page to try again. You can still read everything here.</p>
      </section>
    );
  }
  const { move, apologies } = detail;
  const waiting = apologies.some((a) => a.state === 'pending');
  const accepted = apologies.some((a) => a.state === 'accepted');
  const next = waitEnds !== null && waitEnds > Date.now() ? waitEnds : null;
  const seq = move?.seq ?? null;
  const href = move ? (seq !== null ? threadHref(move.thread, pageOf(seq, settings.postsPerPage), seq) : `/t/${move.thread}`) : null;
  return (
    <section className="kb-composer kb-barred kb-box" aria-labelledby={head}>
      <h2 className="kb-barred-head" id={head}>{heading}</h2>
      <p>
        {who} put <strong>{character.name}</strong> in <strong>{group}</strong>{move ? ` on ${shortDate(move.createdAt)}` : ''}, and {group} can't post here.{' '}
        {bar.expiresAt ? <>It ends on <strong>{shortDate(bar.expiresAt)}</strong>, or sooner if {lowerFirst(who)} accepts a public apology.</> : <>It ends if {lowerFirst(who)} accepts a public apology.</>}
        {' '}You can still read everything here.
      </p>
      {waiting && <p role="status">Your apology is with {lowerFirst(who)}.</p>}
      {!waiting && accepted && <p role="status">Your apology was accepted. The bar lifts within a few minutes.</p>}
      {!waiting && !accepted && next !== null && <p role="status">Your last apology was turned down. The next can be written {dayAndTime(new Date(next).toISOString())}.</p>}
      {writing && (
        <SpinForm
          origin={bar.move} label={null} apology={{ to: lowerFirst(who) }}
          onClose={() => { setWriting(false); write.current?.focus(); }}
        />
      )}
      <div className="kb-barred-actions">
        {!waiting && !accepted && next === null && !writing && (
          <button ref={write} type="button" className="kb-button" data-kb-size="small" onClick={() => setWriting(true)}>Write an apology</button>
        )}
        {href !== null && <Link to={href} className="kb-button" data-kb-size="small">See the move</Link>}
        {/* The barred box's Appeal (with its price, opening Mod Bots' appeal form on the move) goes here: Task 14. */}
      </div>
    </section>
  );
}

/** When the next apology may be written: the latest opening among those that count (a returned one has none), or null when none holds. */
function nextWrittenAt(apologies: readonly Apology[]): number | null {
  const times = apologies.filter((a) => a.state !== 'returned' && a.nextAt !== null).map((a) => Date.parse(a.nextAt!));
  return times.length === 0 ? null : Math.max(...times);
}
