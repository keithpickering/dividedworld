/**
 * The page's one tip (docs/plans/2026-11-02-onboarding-design.md, section 7). Components ask for a tip (`want`); this decides which
 * one shows this page load, and nothing else in the engine does. No component here (it reads only whether a modal is open), so the rules are driven without drawing a screen.
 *
 * Pacing: a page load shows one tip. The first to be decided spends the page's budget for its `group`; a later request of another
 * group is dropped for the load, and one of the same group (the HUD tour's three steps) queues behind it.
 *
 * Dropped for the load: a request decided while focus is in a text field or a contenteditable, while a game effect holds the
 * screen (`hold`), or while a modal is open. A tip that cannot show waits for the next load: a dropped key is not asked again.
 * A tip withdrawn after it was decided (its component unmounts, or its `when` goes false) is settled for the load all the same:
 * if it was showing it goes, unseen, and it is not asked again.
 *
 * Modals: a modal being open does not drop a tip whose target stands inside the top modal itself (the reaction grid, in the open
 * picker). The tip is about that layer, and its spotlight is drawn above it (`topModalHolds` spares it).
 *
 * Holds: a hold that begins under the tip already showing does not drop it. `active()` returns null (the spotlight hides, unseen)
 * until the hold lets go, and then the same tip shows again. For a game effect's takeover the hold is the only barrier, and it
 * wins even over a target inside the top modal, so a takeover must hold the screen while it shows.
 *
 * State: a tip shows only while the account's tips are on and its key is not among those seen. `see` and `skip` update this at once
 * and tell the account through the handlers; a write that fails leaves the account unchanged, so the tip shows again on the next
 * load. Skipping ends every tip: the queue, the active one and the callouts (`calloutOpen`).
 *
 * The callouts (engine/ui/cards/Callout.tsx) share the budget: they show only while the tips are on, only when no spotlight is
 * active or able to show (a spotlight first), and the first callout shown spends the budget as the group `callout`, which no
 * spotlight shares. A store with no provider is `open` and gates nothing.
 */
import { modalOpen, topModalHolds } from '../modal.tsx';
import type { TipKey } from './keys.ts';

/** Where in a sequence a tip is: "2 of 3". */
export interface TipStep { readonly n: number; readonly of: number }

export interface TipRequest {
  readonly key: TipKey;
  /** The element the spotlight cuts out. Read when the tip is decided and again as the page moves. */
  readonly target: () => HTMLElement | null;
  readonly step?: TipStep;
  /** Tips of one group share the page's budget in turn (the tour's steps); the default is the key's own. */
  readonly group?: string;
  /** A button before Got it: pressing it runs this (inside the click, so a browser's permission prompt sees the tap) and then sees the tip. */
  readonly action?: { readonly run: () => void };
}

export interface ActiveTip {
  readonly key: TipKey;
  readonly target: HTMLElement;
  readonly step: TipStep | undefined;
  readonly action: { readonly run: () => void } | undefined;
}

export interface TipsHandlers {
  readonly see: (key: TipKey) => Promise<unknown>;
  readonly skip: () => Promise<unknown>;
}

export interface TipsStore {
  subscribe(listener: () => void): () => void;
  /** The tip showing now, if any: a new object only when it changes. */
  active(): ActiveTip | null;
  /** What the account says: null while it is not read, or for a visitor (nothing shows). */
  load(state: { readonly tips: 'on' | 'off'; readonly seen: readonly string[]; readonly welcomedAt?: string | null } | null): void;
  /** Whether the account has seen the welcome (the HUD tour waits for it); false while the account is not read. */
  welcomed(): boolean;
  /** Ask to show a tip this load; the returned function withdraws the request. */
  want(request: TipRequest): () => void;
  /**
   * Whether the account's tips are on and `key`'s line is still to be carried: it is not among those seen, or it was noted this
   * load and not yet `done`, so a callout that moves to another mark keeps the line. False while the account is not read.
   */
  unseen(key: TipKey): boolean;
  /** `key`'s line went out with a callout: it is seen (the account is told) and carried by whichever callout shows until `done`. */
  note(key: TipKey): void;
  /** The callout carrying `key`'s line was dismissed: no later callout this load carries it. */
  done(key: TipKey): void;
  /** Whether a game effect holds the screen now. */
  holding(): boolean;
  /** A game effect holds the screen (Stick Around's view) or lets it go; `who` names the effect. */
  hold(who: string, held: boolean): void;
  /** Whether the tip `key` has been decided and is up now (shown, or hidden only by a hold). */
  isOpen(key: TipKey): boolean;
  /** Got it: the active tip is seen. */
  see(): void;
  /** Skip all tips: every tip, and every callout, is over until the account restores them. */
  skip(): void;
  /** Whether a card callout may show now, and `spend` records that one did. */
  calloutOpen(): boolean;
  spend(group: string): void;
}

const FIELD = 'input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=image]), textarea, select, [contenteditable]:not([contenteditable=false])';

/** Whether focus is in something a player types in. */
export function typing(doc: Document = document): boolean {
  const at = doc.activeElement;
  return at instanceof HTMLElement && (at.isContentEditable || at.matches(FIELD));
}

interface Entry { readonly id: number; readonly request: TipRequest; readonly group: string }

export function createTipsStore(handlers: TipsHandlers, options: { readonly ungated?: boolean } = {}): TipsStore {
  const listeners = new Set<() => void>();
  let prefs: { tips: 'on' | 'off'; seen: Set<string>; welcomed: boolean } | null = null;
  const queue: Entry[] = [];
  /* Keys decided this load, shown or dropped: asked again, they are not shown again before the next load. */
  const settled = new Set<string>();
  const holders = new Set<string>();
  /* Lines noted this load and not yet dismissed with Got it: the callout showing them may move to another mark, and a callout closed
     another way (its card opened or played) leaves the line to the next callout this load, so it is read once before it goes. */
  const carried = new Set<string>();
  let current: { readonly entry: Entry; readonly view: ActiveTip } | null = null;
  let spent: string | null = null;
  let seq = 0;

  const notify = () => { for (const l of [...listeners]) l(); };
  const eligible = (e: Entry) => prefs !== null && prefs.tips === 'on' && !prefs.seen.has(e.request.key) && !settled.has(e.request.key);
  /* A step of the group already showing carries on from the layer it is leaving, which is still open as its Got it is pressed. */
  const blocked = (carriesOn: boolean, target: HTMLElement | null = null) =>
    holders.size > 0 || (!carriesOn && (typing() || (modalOpen() && !topModalHolds(target))));

  /* Decide every request that can be, in the order asked. */
  const decide = () => {
    if (prefs === null) return;
    for (const e of [...queue]) {
      if (!eligible(e)) { drop(e); continue; }
      if (current) { if (current.entry.group !== e.group) drop(e); continue; }
      if (spent !== null && spent !== e.group) { drop(e); continue; }
      const target = e.request.target();
      if (blocked(spent === e.group, target) || !target?.isConnected) { drop(e); continue; }
      queue.splice(queue.indexOf(e), 1);
      settled.add(e.request.key);
      spent = e.group;
      current = { entry: e, view: { key: e.request.key, target, step: e.request.step, action: e.request.action } };
    }
  };
  const drop = (e: Entry) => { queue.splice(queue.indexOf(e), 1); settled.add(e.request.key); };
  const change = () => { decide(); notify(); };

  return {
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    /* A hold that begins while a tip is up hides it, unseen, until the hold lets go: no tip over a held screen, and none lost to one. */
    active: () => (holders.size > 0 ? null : current?.view ?? null),
    load(state) {
      prefs = state === null ? null : { tips: state.tips, seen: new Set(state.seen), welcomed: Boolean(state.welcomedAt) };
      change();
    },
    want(request) {
      const entry: Entry = { id: ++seq, request, group: request.group ?? request.key };
      if (!settled.has(request.key) && current?.view.key !== request.key) { queue.push(entry); change(); }
      return () => {
        const at = queue.indexOf(entry);
        let changed = false;
        if (at >= 0) { queue.splice(at, 1); changed = true; }
        /* The page the tip points at is gone: the tip goes, and is not seen. */
        if (current?.entry.id === entry.id) { current = null; changed = true; }
        /* A request already decided and gone from the queue leaves nothing to tell. */
        if (changed) change();
      };
    },
    welcomed: () => prefs?.welcomed ?? false,
    unseen: (key) => prefs !== null && prefs.tips === 'on' && (!prefs.seen.has(key) || carried.has(key)),
    note(key) {
      if (prefs === null || prefs.tips === 'off' || prefs.seen.has(key)) return;
      prefs.seen.add(key);
      carried.add(key);
      void Promise.resolve(handlers.see(key)).catch(() => {});
      /* No subscriber reads a seen key, but a queued request for it is now ineligible, and deciding drops it. */
      decide();
    },
    done(key) { carried.delete(key); },
    isOpen: (key) => current?.view.key === key,
    holding: () => holders.size > 0,
    hold(who, held) {
      if (held ? holders.has(who) : !holders.has(who)) return;
      if (held) holders.add(who); else holders.delete(who);
      notify();
    },
    see() {
      if (!current) return;
      const key = current.view.key;
      prefs?.seen.add(key);
      current = null;
      void Promise.resolve(handlers.see(key)).catch(() => {});
      change();
    },
    skip() {
      if (prefs) prefs.tips = 'off';
      current = null;
      queue.length = 0;
      void Promise.resolve(handlers.skip()).catch(() => {});
      notify();
    },
    calloutOpen() {
      if (options.ungated) return true;
      if (prefs === null || prefs.tips === 'off') return false;
      if (current) return false;
      if (spent !== null && spent !== 'callout') return false;
      /* A spotlight that can show comes first. */
      return !queue.some((e) => eligible(e) && !blocked(false, e.request.target()));
    },
    spend(group) {
      if (spent === null) { spent = group; notify(); }
    },
  };
}
