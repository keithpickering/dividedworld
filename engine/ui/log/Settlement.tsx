/**
 * The settlement's summary, as the Settlement board draws it (docs/research/2026-10-29-two-worlds/09-settlement.html;
 * the web plan's glass amendment to Task 8; the design, section 8): "While you were away", on the
 * player's first load after a settlement they have not seen. A results screen with no menu bar: a tab
 * per character, the wallet before and after with the orbs filling to it, each reason in the log's own
 * words with its amount, a rank change and a Turn that took effect, then Open my log and Back to the
 * board, and Esc, which goes back as Back does (the glass plan, section 9, choice 8).
 *
 * It reads the same rows as the log (useLog.ts, lines.ts) and says nothing the log does not: its
 * reasons are the breakdown's reasons with the same totals, its rank and Turn the log's lines for the
 * same settlement, its wallet and what the cap or the floor held back the settlement's own row's. It
 * gains no breakdown of its own; Open my log opens the log on this settlement's row, open (the log
 * shares design, section 4).
 *
 * `SettlementOnLoad` opens it: once the session is known, where the app says a load may be met by it
 * (a board page, not a glass page the player went to), it asks when the last settlement was
 * (`lastSettledAt`, public) and, if this device has not marked it seen for this account, reads the log;
 * a settlement that holds a line of the player's opens the summary, and one that holds nothing of
 * theirs is marked seen without opening (a Turn alone, with no line, is the log's and the roster's). The mark is this device's alone
 * (`kb-settled-seen:<account>`), sent nowhere (the design, Open: the last settlement seen is kept on
 * the device). It is set as the summary shows, so it does not show again after either way out.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { micros } from '../data/log-page.ts';
import { backHref, boardPlace, useBackToBoard } from '../glass/back.ts';
import { pageEscape, plainClick } from '../glass/keys.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { usePlayer } from '../player.tsx';
import { Link, useNavigate } from '../router.tsx';
import { heldBack, inOrder, plain, rankChanges, scoredAs, signed, turnsTaken, utcWhen, type LogData, type Words } from './lines.ts';
import { tabsOf, type LogOpening } from './Log.tsx';
import { useLog } from './useLog.ts';
import './settlement.css';

/** Where this device keeps the last settlement an account has seen, by its end. */
export const seenKey = (account: Id) => `kb-settled-seen:${account}`;

const readSeen = (account: Id): string | null => { try { return globalThis.localStorage?.getItem(seenKey(account)) ?? null; } catch { return null; } };
const markSeen = (account: Id, endsAt: string) => { try { globalThis.localStorage?.setItem(seenKey(account), endsAt); } catch { /* a device that keeps nothing shows it again: no harm */ } };

/** The summary of the newest settlement in `data`, for one character's tab. */
export function Summary({ data, tab, onTab }: { readonly data: LogData; readonly tab: Id | null; readonly onTab: (tab: Id) => void }) {
  const { instance, ui, settings } = useKayfa();
  const words: Words = { instance, ui, postsPerPage: settings.postsPerPage };
  const s = data.log.settlements[0]!;
  const tabs = tabsOf(data);
  const current = tabs.find((c) => c.id === tab) ?? tabs.find((c) => s.lines.some((l) => l.character === c.id)) ?? tabs[0];
  const lines = inOrder(s.lines.filter((l) => l.character === current?.id));
  const event = data.log.wallet.find((e) => e.kind === 'settlement' && e.settlement === s.id);
  const cls = scoredAs(lines, instance);
  const rank = (rankChanges(data, instance).get(s.id) ?? []).find((r) => r.character === current?.id);
  const turn = (turnsTaken(data, instance).get(s.id) ?? []).find((t) => t.character === current?.id);
  const held = heldBack(event, settings.walletCap);
  const className = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const back = useBackToBoard();
  const why = `Why, in plain words${cls ? ` · scored as ${/^[aeiou]/iu.test(className(cls)) ? 'an' : 'a'} ${className(cls)}` : ''}`;
  const turnAct = turn?.announced ? data.acts.get(turn.announced.act) : undefined;
  const turnTitle = turnAct ? data.titles.get(turnAct.thread) : undefined;
  const opening: LogOpening = { open: s.id, character: current?.id };
  return (
    <div className="kb-settled">
      <header className="kb-settled-head">
        <div className="kb-settled-top">
          <p className="kb-settled-when kb-calm">Settled {utcWhen(s.endsAt)} UTC</p>
          {tabs.length > 0 && (
            <nav aria-label="Your characters" className="kb-settled-tabs kb-calm">
              {tabs.map((c) => (
                <button key={c.id} type="button" className="kb-settled-tab kb-glass-skew" aria-pressed={c.id === current?.id} onClick={() => onTab(c.id)}><span className="kb-glass-upright">{c.name}</span></button>
              ))}
            </nav>
          )}
        </div>
        <h1 className="kb-settled-title kb-glass-display kb-calm">While you were away</h1>
      </header>

      <div className="kb-settled-body">
        <section aria-label="Wallet" className="kb-settled-wallet">
          {event
            ? (
              <>
                <div className="kb-settled-orbs kb-calm">
                  <Orbs settled={event.balanceAfter} pending={0} cap={settings.walletCap} figures={false} cascadeFrom={event.balanceAfter - event.change} label={`Wallet now ${plain(event.balanceAfter)} of ${plain(settings.walletCap)}`} />
                </div>
                <p className="kb-settled-move kb-calm">
                  <span className="kb-settled-was">{plain(event.balanceAfter - event.change)} →</span>
                  <span className="kb-settled-now kb-glass-display">{plain(event.balanceAfter)}</span>
                  <span className="kb-settled-change" data-kb-sign={Math.sign(event.change)}>{signed(event.change)}</span>
                </p>
              </>
            )
            : <p className="kb-settled-move kb-calm">Your wallet did not move.</p>}
          {lines.length > 0
            ? (
              <div className="kb-settled-why kb-calm">
                <h2 className="kb-settled-why-head" id="kb-settled-why">{why}</h2>
                <ul className="kb-settled-lines" aria-labelledby="kb-settled-why">
                  {lines.map((l) => (
                    <li key={l.reason} className="kb-settled-line">
                      <span data-kb-reason="">{ui.reasonWords(l.reason)}</span>
                      <span className="kb-settled-amount" data-kb-amount="" data-kb-sign={Math.sign(l.amount)}>{signed(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                {held && <p className="kb-settled-held">{held}</p>}
              </div>
            )
            : <p className="kb-settled-why kb-calm">Nothing was settled for {current?.name ?? 'you'} in this window.</p>}
        </section>

        <div className="kb-settled-cards">
          {rank && (
            <section aria-label={rank.rankNow > rank.rankWas ? 'Rank up' : 'Rank down'} className="kb-settled-rank kb-glass-chamfer-4">
              <div className="kb-settled-card-label">{rank.rankNow > rank.rankWas ? 'New rank' : 'Rank down'}</div>
              <div className="kb-settled-rank-was">{instance.ranks[rank.rankWas]?.name}</div>
              <div className="kb-settled-rank-now kb-glass-display">{instance.ranks[rank.rankNow]?.name}</div>
              <div className="kb-settled-pips" role="img" aria-label={`Rank: ${rank.rankNow + 1} of ${instance.ranks.length} pips`}>
                {instance.ranks.map((_, i) => <span key={i} className="kb-settled-pip" data-kb-pip={i < rank.rankNow ? 'full' : i === rank.rankNow ? 'new' : 'empty'} />)}
              </div>
              <p className="kb-settled-card-words">Season standing {plain(rank.before)} → {plain(rank.after)}. Every post of {current?.name}'s now shows the new rank.</p>
            </section>
          )}
          {turn && (
            <section aria-label="Turn" className="kb-settled-turn" style={{ '--kb-settled-class': `var(--kb-glass-class-${turn.classNow}-fill, var(--kb-glass-neon))`, '--kb-settled-class-large': `var(--kb-glass-class-${turn.classNow}-large)` } as CSSProperties}>
              <div className="kb-settled-turn-classes">
                {turn.classWas && <><span className="kb-settled-turn-was kb-glass-display">{className(turn.classWas)}</span><span className="kb-settled-turn-arrow" aria-hidden="true" /></>}
                <span className="kb-settled-turn-now kb-glass-display">{className(turn.classNow)}</span>
              </div>
              <p className="kb-settled-card-words">
                {current?.name}'s Turn took effect. From today it scores as {/^[aeiou]/iu.test(className(turn.classNow)) ? 'an' : 'a'} {className(turn.classNow)}.{' '}
                {turn.announced
                  ? <>The System announced it{turn.announced.was ? ', with the old class,' : ''} in {turnAct && turnTitle ? <Link to={`/t/${turnAct.thread}`}>{turnTitle}</Link> : 'its board'}.</>
                  : 'It was a silent Turn: no one else was told.'}
              </p>
            </section>
          )}
        </div>
      </div>

      <div className="kb-settled-ways kb-calm">
        <Link to="/log" state={opening} className="kb-settled-log kb-glass-skew"><span className="kb-glass-upright">Open my log</span></Link>
        <Link
          to={backHref(boardPlace())}
          className="kb-settled-back kb-glass-skew"
          aria-keyshortcuts="Escape"
          onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); back(); }}
        >
          <span className="kb-glass-upright">Back to the board</span>
        </Link>
      </div>
    </div>
  );
}

/** The summary at /log/settlement: the newest settlement of the player's, the HUD's character's tab first; Esc goes back. */
export function SettlementScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const { session, hudCharacter } = usePlayer();
  const { state } = useLog(api, signedIn, session.account);
  const [picked, setPicked] = useState<Id | undefined>(undefined);
  const back = useBackToBoard();

  /* No menu bar here, so the page answers Esc itself, as the bar does elsewhere (MenuBar.tsx). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageEscape(e)) return;
      e.preventDefault();
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back]);

  const newest = state.status === 'ready' ? state.data.log.settlements[0] : undefined;
  useEffect(() => {
    if (newest && session.account) markSeen(session.account, newest.endsAt);
  }, [newest, session.account]);

  if (signedIn === false) return <div className="kb-settled"><div className="kb-calm"><SignInPrompt /></div></div>;
  if (signedIn === null || state.status === 'loading') return <div className="kb-settled" aria-busy="true" />;
  if (state.status === 'failed') return <div className="kb-settled"><p className="kb-calm">The settlement could not be loaded. Reload the page to try again.</p></div>;
  if (!newest) return <div className="kb-settled"><p className="kb-calm">Nothing has settled for you yet.</p></div>;
  return <Summary data={state.data} tab={picked ?? hudCharacter?.id ?? null} onTab={setPicked} />;
}

/** The accounts this load has looked for an unseen settlement for, by backend: a load is one backend, made once (web/src/main.tsx). */
let looked = new WeakMap<object, Set<Id>>();

/** Forgets what this load has looked for, as a new page load starts afresh: for a test that loads twice on one backend. */
export function startLoad(): void {
  looked = new WeakMap();
}

/**
 * Opens the summary on the first load after a settlement this device has not seen for the account. `active` is the app's word that
 * the load may be met by it (a board page); it looks once per load and account.
 */
export function SettlementOnLoad({ active }: { readonly active: boolean }) {
  const { api } = useKayfa();
  const { session, sessionKnown } = usePlayer();
  const navigate = useNavigate();
  useEffect(() => {
    const account = session.account;
    if (!sessionKnown || !account) return undefined;
    /* Once per load and account, whatever page the load met: a load of a glass page is not met by it later, on a move to the board. */
    const seenThisLoad = looked.get(api) ?? new Set<Id>();
    looked.set(api, seenThisLoad);
    if (seenThisLoad.has(account)) return undefined;
    seenThisLoad.add(account);
    if (!active) return undefined;
    let live = true;
    void (async () => {
      const last = await api.lastSettledAt();
      if (!last) return;
      const seen = readSeen(account);
      if (seen !== null && micros(seen) >= micros(last)) return;
      const newest = (await api.log()).settlements[0];
      if (!live) return;
      markSeen(account, last);
      /* The summary is of a settlement the player has lines in; one that scored nothing of theirs is only marked. */
      if (newest && micros(newest.endsAt) === micros(last)) navigate('/log/settlement');
    })().catch(() => { /* a load the summary could not be read for opens as it would have */ });
    return () => { live = false; };
  }, [active, api, navigate, session.account, sessionKnown]);
  return null;
}
