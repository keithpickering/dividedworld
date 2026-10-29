/**
 * Invites: make one (a link to copy), the cap and expiry said plainly before the cap is hit, and
 * reissue. A code is shown once, when it is made or reissued; the server never shows it again.
 * An admin holds any number, and the page says so instead of a cap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { MyInvite } from '../data/api.ts';
import { Ago } from '../mini.tsx';
import { Link } from '../router.tsx';
import { useSession } from './session.ts';
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

export function InvitesScreen() {
  const { api, settings } = useKayfa();
  const session = useSession(api);
  const [rows, setRows] = useState<readonly MyInvite[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [list, isAdmin] = await Promise.all([api.invites(), api.isAdmin()]);
    setRows(list);
    setAdmin(isAdmin);
  }, [api]);
  const account = session?.account ?? null;
  useEffect(() => {
    if (!account) return;
    void load().catch(() => setRefusal('Your invites could not be read right now. Reload the page to try again.'));
  }, [account, load]);

  if (session === null) return <div className="kb-account" aria-busy="true" />;
  if (!session.signedIn || !account) {
    return <div className="kb-account"><h1 className="kb-heading">Invites</h1><p><Link to="/sign-in">Sign in</Link> to make invites.</p></div>;
  }
  if (rows === null) return <div className="kb-account" aria-busy="true"><h1 className="kb-heading">Invites</h1>{refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}</div>;

  const cap = settings.invitesPerPlayer;
  const open = rows.filter((i) => !i.used && !i.expired).length;
  const atCap = !admin && open >= cap;
  const lifetime = spanWords(settings.inviteLifetime);

  const run = async (make: () => ReturnType<typeof api.createInvite>, reissued: boolean) => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setCopied(false);
    const r = await make();
    if (r.ok) {
      setShown({ invite: r.value.invite, link: linkTo(r.value.code), reissued });
      await load().catch(() => undefined);
    } else {
      setRefusal(r.error);
      await load().catch(() => undefined);
    }
    setBusy(false);
  };

  const copy = async () => {
    if (!shown) return;
    try {
      await globalThis.navigator.clipboard.writeText(shown.link);
      setCopied(true);
    } catch {
      /* No clipboard here: select the text, so the player copies it by hand. */
      linkField.current?.focus();
      linkField.current?.select();
      setCopied(false);
    }
  };

  return (
    <div className="kb-account kb-invites">
      <h1 className="kb-heading">Invites</h1>
      <p id="kb-invite-count">
        {admin
          ? 'You are an admin: you hold any number of invites.'
          : `You hold ${open} of ${cap} open invites${atCap ? ', the most there are' : ''}.`}{' '}
        An invite is one use, and expires {lifetime} after it is made or reissued. {admin ? '' : 'One used or expired frees one.'}
      </p>
      <p>
        <button type="button" className="kb-button" data-kb-primary disabled={busy || atCap} aria-describedby="kb-invite-count" onClick={() => void run(() => api.createInvite(), false)}>
          Make an invite
        </button>
      </p>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}

      {shown && (
        <section className="kb-invite-new kb-box" aria-label="Your new invite">
          <p className="kb-box-head">{shown.reissued ? 'A new code for invite' : 'Invite'} {shown.invite}</p>
          <label className="kb-field">
            <span>Invite link</span>
            <input ref={linkField} className="kb-input kb-mono kb-invite-link" readOnly value={shown.link} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <p>
            <button type="button" className="kb-button" onClick={() => void copy()}>Copy the link</button>{' '}
            {copied && <span role="status">Copied.</span>}
          </p>
          <p className="kb-notice">This link will not be shown again. Copy it now and send it to the person you invite; anyone who has it can use it once. If you lose it, reissue the invite for a new one.</p>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="kb-muted">You have made no invites.</p>
      ) : (
        <table className="kb-table kb-invite-table">
          <caption className="kb-visually-hidden">Your invites</caption>
          <thead><tr><th scope="col">Made</th><th scope="col">Status</th><th scope="col"><span className="kb-visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Ago at={i.createdAt} /></td>
                <td>
                  {statusOf(i)}
                  {!i.used && i.expiresAt && <> <span className="kb-muted">{i.expired ? 'Expired' : 'Expires'} <Ago at={i.expiresAt} /></span></>}
                </td>
                <td>
                  {!i.used && <button type="button" className="kb-button" disabled={busy} onClick={() => void run(() => api.reissueInvite(i.id), true)}>Reissue<span className="kb-visually-hidden"> invite {i.id}</span></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
