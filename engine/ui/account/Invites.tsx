/**
 * Invites, the Invites row of Settings › Account (Settings.tsx; the glass plan, section 8): make one
 * (a link to copy), the cap and expiry said plainly before the cap is hit, and reissue. A code is
 * shown once, when it is made or reissued; the server never shows it again. An admin holds any
 * number, and the row says so instead of a cap. Settings shows it only to a signed-in account.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LOST_ANSWER } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import type { MyInvite } from '../data/api.ts';
import { Ago } from '../mini.tsx';
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

export function Invites() {
  const { api, settings } = useKayfa();
  const [rows, setRows] = useState<readonly MyInvite[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const justShown = useRef(false);
  const linkField = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [list, isAdmin] = await Promise.all([api.invites(), api.isAdmin()]);
    setRows(list);
    setAdmin(isAdmin);
  }, [api]);
  /* A new link is where the player's attention goes next: it holds the code that will not come again. */
  useEffect(() => {
    if (shown && justShown.current) { justShown.current = false; linkField.current?.focus(); linkField.current?.select(); }
  }, [shown]);
  useEffect(() => {
    void load().catch(() => setRefusal('Your invites could not be read right now. Reload the page to try again.'));
  }, [load]);

  if (rows === null) return <div className="kb-invites" aria-busy="true">{refusal && <p role="alert" className="kb-acct-refusal">{refusal}</p>}</div>;

  const cap = settings.invitesPerPlayer;
  const open = rows.filter((i) => !i.used && !i.expired).length;
  const atCap = !admin && open >= cap;
  const lifetime = spanWords(settings.inviteLifetime);

  const run = async (make: () => ReturnType<typeof api.createInvite>, reissued: boolean) => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setNote('');
    try {
      const r = await make();
      if (r.ok) {
        setShown({ invite: r.value.invite, link: linkTo(r.value.code), reissued });
        justShown.current = true;
      } else {
        setRefusal(r.error);
      }
    } catch {
      setRefusal(LOST_ANSWER);
    } finally {
      setBusy(false);
    }
    await load().catch(() => undefined);
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
      <p>
        <button type="button" className="kb-acct-button kb-glass-skew" data-kb-primary="" disabled={busy || atCap} aria-describedby="kb-invite-count" onClick={() => void run(() => api.createInvite(), false)}>
          <b className="kb-glass-upright">Make an invite</b>
        </button>
      </p>
      {refusal && <p role="alert" className="kb-acct-refusal">{refusal}</p>}
      <p role="status" className="kb-acct-note">{note}</p>

      {shown && (
        <section className="kb-invite-new kb-glass-cut-panel" aria-label="Your new invite">
          <p className="kb-invite-new-head">{shown.reissued ? 'A new code for invite' : 'Invite'} {shown.invite}</p>
          <label className="kb-acct-field">
            <span className="kb-acct-field-label">Invite link</span>
            <input ref={linkField} className="kb-acct-input kb-invite-link" readOnly value={shown.link} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <p><button type="button" className="kb-acct-button kb-glass-skew" onClick={() => void copy()}><b className="kb-glass-upright">Copy the link</b></button></p>
          <p className="kb-acct-text">This link will not be shown again. Copy it now and send it to the person you invite; anyone who has it can use it once. If you lose it, reissue the invite for a new one.</p>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="kb-acct-text">You have made no invites.</p>
      ) : (
        <table className="kb-invite-table">
          <caption className="kb-visually-hidden">Your invites</caption>
          <thead><tr><th scope="col">Made</th><th scope="col">Status</th><th scope="col"><span className="kb-visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Ago at={i.createdAt} /></td>
                <td>
                  {statusOf(i)}
                  {!i.used && i.expiresAt && <> <span className="kb-invite-when">{i.expired ? 'since' : 'expires'} <Ago at={i.expiresAt} /></span></>}
                </td>
                <td>
                  {!i.used && <button type="button" className="kb-acct-button kb-glass-skew" disabled={busy} onClick={() => void run(() => api.reissueInvite(i.id), true)}><b className="kb-glass-upright">Reissue<span className="kb-visually-hidden"> invite {i.id}</span></b></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
