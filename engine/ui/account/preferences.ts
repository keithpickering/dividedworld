/**
 * The account's preferences as a screen holds and saves them: read once when the screen opens, a choice shown and applied to the page at
 * once (applyAppearance), its save waiting for the ones before it (one out at a time, so the account ends with the last choice made).
 * Settings and the welcome page's Before you start draw their rows with one control each (appearanceRows.tsx) and save them with this, so
 * a choice made on either behaves the same.
 *
 * What the screen read is kept with the account it was read for and returned only while that account is the one signed in: when the
 * session changes in another tab, the next account's reads are still out for a commit or more, and the last account's choices never
 * stand in. A refusal puts back that choice alone, to what the account last confirmed for it, and only while the screen still shows the
 * refused value: a later choice of the same setting, still to be saved, is left on the screen for its own answer. An answer that comes
 * once the player has signed out, another account has signed in or the screen has gone puts nothing on the page: the app has put the
 * next look on the root by then.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER, type Answer, type Preferences, type PreferencesPatch } from '../data/api.ts';
import { applyAppearance } from '../appearance.ts';
import { announceToastChoice } from '../alerts/toast-choice.ts';
import { setTiltPreference } from '../shine/tilt.ts';

/** A patch of exactly one setting: `change` saves one at a time, so it takes one. */
export type SinglePatch = { readonly [K in keyof PreferencesPatch]-?: { readonly [P in K]: Required<PreferencesPatch>[K] } }[keyof PreferencesPatch];

export type TipsChange = 'skip' | 'resume' | 'restore' | 'replay';

export interface SavedPreferences {
  /** The account's choices as the page holds them now; null until they are read for the account signed in. */
  readonly prefs: Preferences | null;
  /** What to say if a read or a save was refused, in plain words. */
  readonly refusal: string | null;
  /** Whether the last thing done was saved to the account. */
  readonly saved: boolean;
  /** Choose one setting: shown and applied at once, saved in its turn. */
  readonly change: (patch: SinglePatch) => void;
  /**
   * Change the tips (Settings' Tips row), in its turn behind the choices before it: `skip` turns them off, `resume` on with nothing forgotten,
   * `restore` on with the tips seen and the cards met forgotten, `replay` on with the HUD tour's steps forgotten (and the welcome marked seen).
   * `skip` and `resume` are shown at once and put back on a refusal; `restore` and `replay` are shown once the account has answered.
   */
  readonly changeTips: (how: TipsChange) => void;
  /** Say a refusal of the screen's own (something other than a preference went wrong). */
  readonly refuse: (text: string) => void;
}

export function usePreferenceSaves(account: string | null): SavedPreferences {
  const { api, ui } = useKayfa();
  const [read, setRead] = useState<{ readonly account: string; readonly prefs: Preferences } | null>(null);
  const [refusalFor, setRefusal] = useState<{ readonly account: string | null; readonly text: string } | null>(null);
  const [savedFor, setSaved] = useState<string | null>(null);
  const prefs = read?.account === account ? read.prefs : null;
  const refusal = refusalFor && refusalFor.account === account ? refusalFor.text : null;
  const saved = account !== null && savedFor === account;
  /* The choices as the page holds them now (before the server has answered), what the account last confirmed, and the saves in line. */
  const current = useRef<Preferences | null>(null);
  const confirmed = useRef<Preferences | null>(null);
  const line = useRef<Promise<void>>(Promise.resolve());
  /* The number of the last save queued: "Saved" is said only by the save that is last in line, never while a later one is still out. */
  const queued = useRef(0);
  /* The number of the clicks on the Tips switch (skip, resume) alone: no other choice moves it, so an answer can tell a later switch click from a later theme. */
  const switchClicks = useRef(0);
  /* The account the screen is for now, and null once it is gone: a save answered after either changed is that account's no longer. */
  const showing = useRef<string | null>(null);
  useEffect(() => {
    showing.current = account;
    return () => { showing.current = null; };
  }, [account]);

  useEffect(() => {
    if (!account) return undefined;
    let live = true;
    void api.preferences().then((p) => { if (live) { current.current = p; confirmed.current = p; setRead({ account, prefs: p }); setTiltPreference(p.tilt); } }, () => { if (live) setRefusal({ account, text: 'Your settings could not be read right now. Reload the page to try again.' }); });
    return () => { live = false; };
  }, [api, account]);

  const change = useCallback((patch: SinglePatch) => {
    const key = Object.keys(patch)[0] as keyof PreferencesPatch;
    const asked = (patch as PreferencesPatch)[key];
    const mine = ++queued.current;
    const madeFor = account;
    if (madeFor === null || current.current === null) return;
    const show = (next: Preferences) => { current.current = next; setRead({ account: madeFor, prefs: next }); applyAppearance(document, next, ui.themes, ui.glass); setTiltPreference(next.tilt); };
    show({ ...current.current, ...patch });
    setRefusal(null);
    setSaved(null);
    line.current = line.current.then(async () => {
      let r: Answer<Preferences>;
      try { r = await api.setPreferences(patch as PreferencesPatch); } catch { r = { ok: false, error: LOST_ANSWER }; }
      if (showing.current !== madeFor) return;
      if (r.ok) {
        confirmed.current = { ...confirmed.current!, [key]: r.value[key] };
        if (queued.current === mine) setSaved(madeFor);
        /* The HUD read the choice when it mounted; it hears this one as the account has it. */
        if (key === 'toasts') announceToastChoice(r.value.toasts);
        return;
      }
      if (current.current![key] === asked) show({ ...current.current!, [key]: confirmed.current![key] });
      setRefusal({ account: madeFor, text: r.error });
    }).catch(() => {
      /* Nothing in the line may end it: a choice after a throw is still sent, and it is said and put back as a lost answer is. */
      if (showing.current !== madeFor) return;
      if (current.current && confirmed.current && current.current[key] === asked) show({ ...current.current, [key]: confirmed.current[key] });
      setRefusal({ account: madeFor, text: LOST_ANSWER });
    });
  }, [api, ui, account]);

  /*
   * It waits its turn behind the choices before it. `skip` and `resume` are shown at once, as `change` shows a choice, and put back on a
   * refusal only while the switch still shows the refused value; so the last click wins. `restore` and `replay` change more than the switch
   * and are shown once the account has answered. An answer never puts the switch back over a later click still to be saved.
   */
  const changeTips = useCallback((how: TipsChange) => {
    const madeFor = account;
    if (madeFor === null || current.current === null) return;
    const mine = ++queued.current;
    const asked = how === 'skip' ? 'off' : how === 'resume' ? 'on' : null;
    if (asked !== null) {
      ++switchClicks.current;
      current.current = { ...current.current, tips: asked };
      setRead({ account: madeFor, prefs: current.current });
    }
    setRefusal(null);
    setSaved(null);
    const clicks = switchClicks.current;
    const putBack = () => {
      if (asked !== null && current.current && confirmed.current && current.current.tips === asked) {
        current.current = { ...current.current, tips: confirmed.current.tips };
        setRead({ account: madeFor, prefs: current.current });
      }
    };
    line.current = line.current.then(async () => {
      let r: Answer<Preferences>;
      try { r = await (how === 'skip' ? api.skipTips() : how === 'resume' ? api.resumeTips() : how === 'restore' ? api.restoreTips() : api.replayTour()); } catch { r = { ok: false, error: LOST_ANSWER }; }
      if (showing.current !== madeFor) return;
      if (r.ok) {
        const kept = { cardsMet: r.value.cardsMet, tips: r.value.tips, tipsSeen: r.value.tipsSeen, welcomedAt: r.value.welcomedAt };
        confirmed.current = { ...confirmed.current!, ...kept };
        /* A later click on the switch (not on another choice) is still to be saved: the screen keeps what it shows for it. */
        current.current = { ...current.current!, ...kept, tips: switchClicks.current === clicks ? kept.tips : current.current!.tips };
        setRead({ account: madeFor, prefs: current.current });
        if (queued.current === mine) setSaved(madeFor);
        return;
      }
      putBack();
      setRefusal({ account: madeFor, text: r.error });
    }).catch(() => { if (showing.current === madeFor) { putBack(); setRefusal({ account: madeFor, text: LOST_ANSWER }); } });
  }, [api, account]);

  const refuse = useCallback((text: string) => { if (account !== null) setRefusal({ account, text }); }, [account]);

  return { prefs, refusal, saved, change, changeTips, refuse };
}
