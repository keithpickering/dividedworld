/**
 * Invites, the Invites row of Settings › Account (Settings.tsx; the glass plan, section 8; the backfill design, section 7, board 33):
 * the cap and expiry said plainly before the cap is hit, a row for each invite (which one it is, its state and when, and Reissue while
 * it is unused), then Make an invite (a link to copy). A code is shown once, when it is made or reissued; the server never shows it
 * again, so a row never carries it. An admin holds any number, and the row says so instead of a cap. Settings shows it only to a
 * signed-in account. The invites are the page's document (the glass-load plan, Task 11), read again through the router after each write.
 */
import { useEffect, useRef, useState } from 'react';
import { LOST_ANSWER } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import { useIsAdmin } from '../mini.tsx';
import { useRouterInternals } from '../router.tsx';
import type { MyInvite } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { spanWords } from './words.ts';
import './account.css';

interface Shown {
  readonly invite: number;
  readonly link: string;
  readonly reissued: boolean;
}

const linkTo = (code: string) => `${globalThis.location.origin}/register?invite=${encodeURIComponent(code)}`;

function statusOf(i: MyInvite): string {
  if (i.used) return 'Used';
  return i.expired ? 'Expired' : 'Open';
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** The date an invite's words rest on, as the account holds it: when it expires (or did), and for a used one, when it was made (the account keeps no date of its use). */
const whenIso = (i: MyInvite): string | null => (i.used ? i.createdAt : i.expiresAt);

/** An invite's "when", the board's: "expires Nov 12" while open, "since Nov 12" once expired, "made Nov 2" once used. */
function whenWords(i: MyInvite): string {
  const at = whenIso(i);
  if (at === null) return '';
  if (i.used) return `made ${day(at)}`;
  return `${i.expired ? 'since' : 'expires'} ${day(at)}`;
}

export function Invites({ invites: rows }: { readonly invites: readonly MyInvite[] }) {
  const { api, settings } = useKayfa();
  const { retry: reload } = useRouterInternals();
  const admin = useIsAdmin(api, true);
  const [shown, setShown] = useState<Shown | null>(null);
  /* The write out: 'make' for a new invite, or the invite's id for its Reissue. Only that control spins; another write waits behind it. */
  const [pending, setPending] = useState<'make' | number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const justShown = useRef(false);
  const linkField = useRef<HTMLInputElement>(null);

  /* A new link is where the player's attention goes next: it holds the code that will not come again. */
  useEffect(() => {
    if (shown && justShown.current) { justShown.current = false; linkField.current?.focus(); linkField.current?.select(); }
  }, [shown]);
  /* A row is numbered by the player's own count, oldest first: the id is one sequence for every account, so it would show the gaps other players' invites leave. */
  const ordinal = new Map([...rows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id).map((i, n) => [i.id, n + 1]));
  const cap = settings.invitesPerPlayer;
  const open = rows.filter((i) => !i.used && !i.expired).length;
  const atCap = !admin && open >= cap;
  const lifetime = spanWords(settings.inviteLifetime);

  const run = async (key: 'make' | number, make: () => ReturnType<typeof api.createInvite>, reissued: boolean) => {
    if (pending !== null) return;
    setPending(key);
    setRefusal(null);
    setNote('');
    try {
      const r = await make();
      if (r.ok) {
        /* The code is shown at once: the server gives it this once, so nothing waits in front of it. The list is read
           again below, and the head names the invite's number among the player's own once that read lands. */
        setShown({ invite: r.value.invite, link: linkTo(r.value.code), reissued });
        justShown.current = true;
      } else {
        setRefusal(r.error);
      }
    } catch {
      setRefusal(LOST_ANSWER);
    } finally {
      setPending(null);
    }
    /* The list is read again, in place, through the page's own load. */
    reload();
  };

  const copy = async () => {
    if (!shown) return;
    try {
      await globalThis.navigator.clipboard.writeText(shown.link);
      setNote('Copied.');
    } catch {
      /* No clipboard here: select the text, so the player copies it by hand. */
      linkField.current?.focus();
      linkField.current?.select();
      setNote('Copy is not available here: the link is selected; copy it by hand.');
    }
  };

  return (
    <div className="kb-invites">
      <p id="kb-invite-count" className="kb-acct-text">
        {admin
          ? 'You are an admin: you hold any number of invites.'
          : `You hold ${open} of ${cap} open invites${atCap ? ', the most there are' : ''}.`}{' '}
        An invite is one use, and expires {lifetime} after it is made or reissued. {admin ? '' : 'One used or expired frees one.'}
      </p>

      {rows.length === 0 ? (
        <p className="kb-acct-text">You have made no invites.</p>
      ) : (
        <ul className="kb-invite-list" aria-label="Your invites">
          {rows.map((i) => (
            <li key={i.id} className="kb-invite-row">
              {/* The server shows a code once, when it is made or reissued, so a row is named by its number among the player's own. */}
              <span className="kb-invite-code">Invite {ordinal.get(i.id)}</span>
              <span className="kb-invite-state">
                <b className={`kb-invite-status kb-invite-status--${statusOf(i).toLowerCase()}`}>{statusOf(i)}</b>
                {' · '}
                <span title={whenIso(i) ? new Date(whenIso(i)!).toLocaleString('en-US') : undefined}>{whenWords(i)}</span>
              </span>
              <span className="kb-invite-actions">
                {!i.used && <GlassButton size="s" busy={pending === i.id} disabled={pending !== null && pending !== i.id} aria-label={`Reissue invite ${ordinal.get(i.id)}`} onClick={() => void run(i.id, () => api.reissueInvite(i.id), true)}>Reissue</GlassButton>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ButtonRow>
        <GlassButton kind="primary" busy={pending === 'make'} disabled={atCap || (pending !== null && pending !== 'make')} aria-describedby="kb-invite-count" onClick={() => void run('make', () => api.createInvite(), false)}>Make an invite</GlassButton>
      </ButtonRow>
      {refusal && <p role="alert" className="kb-acct-refusal">{refusal}</p>}
      <p role="status" className="kb-acct-note">{note}</p>

      {shown && (
        <section className="kb-invite-new kb-glass-cut-panel" aria-label="Your new invite">
          <p className="kb-invite-new-head">
            {ordinal.has(shown.invite) ? `${shown.reissued ? 'A new code for invite' : 'Invite'} ${ordinal.get(shown.invite)}` : shown.reissued ? 'A new code for your invite' : 'Your new invite'}
          </p>
          <label className="kb-acct-field">
            <span className="kb-acct-field-label">Invite link</span>
            <input ref={linkField} className="kb-acct-input kb-invite-link" readOnly value={shown.link} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <ButtonRow><GlassButton onClick={() => void copy()}>Copy the link</GlassButton></ButtonRow>
          <p className="kb-acct-text">This link will not be shown again. Copy it now and send it to the person you invite; anyone who has it can use it once. If you lose it, reissue the invite for a new one.</p>
        </section>
      )}
    </div>
  );
}
