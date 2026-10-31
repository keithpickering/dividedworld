/**
 * My log, as the Log board draws it (docs/research/2026-10-29-two-worlds/12-log.html; the web plan's
 * Task 8 with its glass amendment; the log shares plan's Task 5): a glass page under the menu bar, one
 * row per line with when (UTC), what, the details with the Act's link, the Aura moved and the wallet
 * after; a tab for All and one per character. The open window's estimate comes first, each reaction's
 * own amount at its own time, labeled as an estimate.
 *
 * A settlement's row carries one Show posts control (the design, section 4) that opens a breakdown
 * under the row, inside the table: each reason with its exact total, its shares beneath it with the
 * post's link, the quadrant's label and the share, then what a share is. A reason the estimate valued
 * on no post says so; a settlement made before shares were kept has no control and says why on its
 * row. The breakdown closes by the same control (Hide posts), by Esc on it or inside it, which returns
 * focus to it, or by leaving the page; nothing about it is kept.
 *
 * Out of character and true ("The fiction may lie; the log never does"): every line is the player's
 * own rows (lines.ts), and nothing names who reacted or anyone's class but the player's own. Which tab
 * is open, and which settlement opens, come with the navigation's state, never in the address
 * (router.tsx): an address that named one of the player's characters would say whose they are to
 * anyone it reached.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, LogSettlement } from '../data/api.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Link, useLocation } from '../router.tsx';
import { actLink, inOrder, logRows, NO_SHARES, plain, reasonName, SHARES_ARE, signed, utcWhen, type LogData, type LogRow, type Segment, type Words } from './lines.ts';
import { useLog } from './useLog.ts';
import './log.css';

/** What a navigation into the log may carry (router.tsx's state): the tab to open, and a settlement to open on its row. */
export interface LogOpening {
  readonly character?: Id;
  readonly open?: number;
}

const openingOf = (state: unknown): LogOpening => {
  if (typeof state !== 'object' || state === null) return {};
  const s = state as Record<string, unknown>;
  return { character: typeof s.character === 'string' ? s.character : undefined, open: typeof s.open === 'number' ? s.open : undefined };
};

export function Said({ parts }: { readonly parts: readonly Segment[] }) {
  return <>{parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <Link key={i} to={p.href}>{p.text}</Link>))}</>;
}

/** The characters a log has tabs for: the player's own that have debuted or have a line, in the order they debuted, as the boards and the roster list them. */
export function tabsOf(data: LogData) {
  const lined = new Set(data.log.settlements.flatMap((s) => s.lines.map((l) => l.character)));
  const since = (c: { readonly debutedAt: string | null }) => (c.debutedAt === null ? Infinity : Date.parse(c.debutedAt));
  return data.mine.filter((c) => c.debutedAt !== null || lined.has(c.id)).sort((a, b) => since(a) - since(b) || a.name.localeCompare(b.name));
}

/** One settlement's breakdown: each reason with its exact total and its shares, the player's whose tab it is (all of them on All). */
function Breakdown({ settlement, data, words, tab, id, open, onClose }: { readonly settlement: LogSettlement; readonly data: LogData; readonly words: Words; readonly tab: Id | null; readonly id: string; readonly open: boolean; readonly onClose: () => void }) {
  const lines = inOrder(settlement.lines.filter((l) => tab === null || l.character === tab));
  const nameOf = (c: Id) => data.mine.find((m) => m.id === c)?.name ?? '';
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || e.repeat || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };
  return (
    <tr id={id} className="kb-log-breakdown" onKeyDown={onKey} hidden={!open}>
      <td colSpan={5}>
        <div className="kb-log-breakdown-body">
          {lines.map((l) => (
            <section key={`${l.character}:${l.reason}`} className="kb-log-reason" aria-label={`${tab === null ? `${nameOf(l.character)}, ` : ''}${reasonName(words.ui.reasonWords(l.reason))}`}>
              <h2 className="kb-log-reason-head">
                <span>
                  {tab === null && <span className="kb-log-reason-who">{nameOf(l.character)} · </span>}
                  <span data-kb-reason="">{words.ui.reasonWords(l.reason)}</span>
                </span>
                <span className="kb-log-num" data-kb-amount="" data-kb-sign={Math.sign(l.amount)}>{signed(l.amount)}</span>
              </h2>
              {l.shares.length === 0
                ? <p className="kb-log-reason-none">{NO_SHARES}</p>
                : (
                  <ul className="kb-log-shares">
                    {l.shares.map((sh) => {
                      const link = actLink(data.acts.get(sh.act), data, words, l.character);
                      return (
                        <li key={`${sh.act}:${sh.quadrant ?? ''}`} className="kb-log-share">
                          <span className="kb-log-share-post">{link === null ? 'an Act' : <Said parts={[link]} />}</span>
                          <span className="kb-log-share-quadrant">{sh.quadrant ? words.ui.quadrantLabels[sh.quadrant] : 'No quadrant'}</span>
                          <span className="kb-log-num" data-kb-sign={Math.sign(sh.amount)}>{signed(sh.amount)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </section>
          ))}
          <p className="kb-log-shares-are">{SHARES_ARE}</p>
        </div>
      </td>
    </tr>
  );
}

function Row({ row, data, words, tab, open, onToggle }: { readonly row: LogRow; readonly data: LogData; readonly words: Words; readonly tab: Id | null; readonly open: boolean; readonly onToggle: (id: number, to?: boolean) => void }) {
  const base = useId();
  const breakdown = `${base}-posts`;
  const button = useRef<HTMLButtonElement>(null);
  const s = row.settlement;
  const close = () => { if (s) onToggle(s.id, false); button.current?.focus(); };
  return (
    <>
      <tr data-kb-kind={row.kind} data-kb-estimate={row.kind === 'estimate' ? '' : undefined}>
        <td className="kb-log-when" data-kb-label="When (UTC)">{utcWhen(row.at)}</td>
        <td className="kb-log-what" data-kb-label="What">{row.what}</td>
        <td className="kb-log-details" data-kb-label="Details">
          <Said parts={row.details} />
          {s?.sharesKept && (
            <div className="kb-log-posts-row">
              <button
                ref={button}
                type="button"
                className="kb-log-posts kb-glass-skew"
                aria-expanded={open}
                aria-controls={breakdown}
                onClick={() => onToggle(s.id)}
                onKeyDown={(e) => { if (e.key === 'Escape' && open && !e.repeat) { e.preventDefault(); close(); } }}
              >
                <span className="kb-glass-upright">{open ? 'Hide posts' : 'Show posts'}</span>
              </button>
            </div>
          )}
        </td>
        <td className="kb-log-num" data-kb-label="Aura" data-kb-sign={Math.sign(row.aura)}>{row.kind === 'estimate' ? `up to ${signed(row.aura)}` : signed(row.aura)}</td>
        <td className="kb-log-num" data-kb-label="Wallet">{row.wallet === null ? '—' : plain(row.wallet)}</td>
      </tr>
      {/* Drawn closed as well as open, hidden, so the control always names the row it opens. */}
      {s?.sharesKept && <Breakdown settlement={s} data={data} words={words} tab={tab} id={breakdown} open={open} onClose={close} />}
    </>
  );
}

export interface LogProps {
  readonly data: LogData;
  /** The tab open: one of the player's characters, or null for All. */
  readonly tab: Id | null;
  readonly onTab: (tab: Id | null) => void;
  /** The settlements whose breakdowns are open. */
  readonly open: ReadonlySet<number>;
  /** Opens or closes a settlement's breakdown: to `to` where given, else the other way. */
  readonly onToggle: (settlement: number, to?: boolean) => void;
  /** Reads the next page; absent when nothing older is left. */
  readonly onOlder?: () => void;
  readonly older?: 'idle' | 'loading' | 'failed';
}

export function Log({ data, tab, onTab, open, onToggle, onOlder, older = 'idle' }: LogProps) {
  const { instance, ui, settings } = useKayfa();
  const words: Words = { instance, ui, postsPerPage: settings.postsPerPage };
  const tabs = tabsOf(data);
  const current = tabs.find((c) => c.id === tab) ?? null;
  const rows = logRows(data, words, settings.walletCap, current?.id ?? null);
  const settled = data.log.settlements.length > 0;
  /* Show older lines goes once the last page is read: focus moves to the table it filled, never to the page's top. */
  const table = useRef<HTMLTableElement>(null);
  const reading = useRef(false);
  const last = data.log.before === null;
  useEffect(() => {
    if (!last || !reading.current) return;
    reading.current = false;
    table.current?.focus();
  }, [last]);
  return (
    <div className="kb-log">
      <div className="kb-log-head">
        <h1 className="kb-log-title kb-glass-display">My log</h1>
        {tabs.length > 0 && (
          <nav aria-label="Whose log" className="kb-log-tabs kb-calm">
            <button type="button" className="kb-log-tab kb-glass-skew" aria-pressed={current === null} onClick={() => onTab(null)}><span className="kb-glass-upright">All</span></button>
            {tabs.map((c) => (
              <button key={c.id} type="button" className="kb-log-tab kb-glass-skew" aria-pressed={current?.id === c.id} onClick={() => onTab(c.id)}><span className="kb-glass-upright">{c.name}</span></button>
            ))}
          </nav>
        )}
      </div>
      <p className="kb-log-lead kb-calm">
        Everything on this page is true. Each line names the Act that did it, what it changed and how much Aura moved. It never says who reacted, or
        any character's class but your own.
      </p>
      {!settled && rows.length === 0
        ? <p className="kb-log-empty kb-calm">Nothing has settled for you yet. Your first settlement is the first line here.</p>
        : (
          <div className="kb-log-board kb-calm">
            <table ref={table} className="kb-log-table" tabIndex={-1}>
              <caption className="kb-visually-hidden">{current ? `${current.name}'s log` : 'Your log'}, newest first</caption>
              <thead>
                <tr>
                  <th scope="col" className="kb-log-when">When (UTC)</th>
                  <th scope="col" className="kb-log-what">What</th>
                  <th scope="col">Details</th>
                  <th scope="col" className="kb-log-num">Aura</th>
                  <th scope="col" className="kb-log-num">Wallet</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <Row key={r.key} row={r} data={data} words={words} tab={current?.id ?? null} open={r.settlement !== undefined && open.has(r.settlement.id)} onToggle={onToggle} />)}
              </tbody>
            </table>
            {!settled && <p className="kb-log-empty">Nothing has settled for you yet. Your first settlement is the first line here.</p>}
            {settled && rows.length === 0 && <p className="kb-log-empty">Nothing on these pages is {current?.name ?? 'yours'}'s yet.</p>}
            {onOlder && data.log.before !== null && (
              <p className="kb-log-older">
                <button type="button" className="kb-log-posts kb-glass-skew" onClick={() => { reading.current = true; onOlder(); }} disabled={older === 'loading'}><span className="kb-glass-upright">Show older lines</span></button>
                {older === 'failed' && <span className="kb-log-older-failed"> The older lines could not be read. Try again.</span>}
              </p>
            )}
          </div>
        )}
      <p className="kb-log-foot kb-calm">If a line here looks wrong, that is a bug and not the game. Tell an admin.</p>
    </div>
  );
}

/** My log at /log: the newest page, the HUD's character's tab unless the navigation chose one, and a settlement open where it asked. */
export function LogScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const { session, hudCharacter } = usePlayer();
  const { state: carried } = useLocation();
  const opening = openingOf(carried);
  const { state, older } = useLog(api, signedIn, session.account);
  /* Undefined until the player picks: the navigation's choice, else the HUD's character. */
  const [picked, setPicked] = useState<Id | null | undefined>(undefined);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(opening.open === undefined ? [] : [opening.open]));
  /* Another account's log starts on its own tab with nothing open. */
  const account = session.account;
  const last = useRef(account);
  useEffect(() => {
    if (last.current === account) return;
    last.current = account;
    setPicked(undefined);
    setOpen(new Set());
  }, [account]);
  if (signedIn === false) return <div className="kb-log"><div className="kb-log-empty kb-calm"><SignInPrompt /></div></div>;
  if (signedIn === null || state.status === 'loading') return <div className="kb-log" aria-busy="true" />;
  if (state.status === 'failed') return <div className="kb-log"><p className="kb-log-empty kb-calm">Your log could not be loaded. Reload the page to try again.</p></div>;
  const tab = picked !== undefined ? picked : (opening.character ?? hudCharacter?.id ?? null);
  const toggle = (id: number, to?: boolean) => setOpen((now) => {
    const next = new Set(now);
    if (to ?? !now.has(id)) next.add(id); else next.delete(id);
    return next;
  });
  return <Log data={state.data} tab={tab} onTab={setPicked} open={open} onToggle={toggle} onOlder={older} older={state.older} />;
}
