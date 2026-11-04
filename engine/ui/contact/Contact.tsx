/**
 * Reach a person, at /contact (the onboarding follow-ups design, section 2): how players reach the admins. A public glass page, readable
 * signed out, because the player who most needs a person is often the one who cannot sign in. It is linked from the sign-in page, the foot of
 * Settings' frame, the log's foot and the guide's closing line, and has no tab of its own.
 *
 * It is plain and never in character (CLAUDE.md, "The fiction may lie; the log never does": Settings, the account, errors and anything about real
 * moderation are written plainly). Its words are the engine's, the same in every instance, and the instance adds nothing to them. The links
 * are the admins': the setting `adminContact`, written on the admin screen (engine/ui/admin/AdminContact.tsx) and read here through
 * `api.adminContact()`. They are the instance's and the same for every reader, signed in or out ("A response never proves a private fact"): the page
 * reads no session, names no account and says nothing about which characters an admin owns.
 *
 * Each link is its label as a link; a `mailto:` link also shows its address as text, so a player whose device has no mail client can still copy
 * it. Only an `https:` or `mailto:` address is drawn as a link, whatever it was handed: the server holds the same line, and this is the second wall.
 * Unset, the page says so plainly.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { CONTACT_WS, type ContactLink } from '../data/api.ts';
import { Link } from '../router.tsx';
import '../account/account.css';
import './contact.css';

/** Where the page is. */
export const CONTACT_PATH = '/contact';

/** The link to the page, in the words every screen that offers it uses. */
export function ReachAPerson({ className }: { readonly className?: string }) {
  return <Link to={CONTACT_PATH} className={className}>Reach a person</Link>;
}

/** The server's shape (set_admin_contact, 0081), applied again: `https://` with a host, or `mailto:` with exactly one name@host and no query; no space or control character. */
const SPACED = new RegExp(`[${CONTACT_WS}]`, 'u');
const safe = (href: string): boolean =>
  !SPACED.test(href) && (/^https:\/\/[^/?#@]+([/?#]|$)/iu.test(href) || /^mailto:[^@:/?#]+@[^@:/?#]+$/iu.test(href));
const address = (href: string): string | null => (/^mailto:/iu.test(href) ? href.replace(/^mailto:/iu, '') : null);

/** The page, handed the links read: `null` while they are read, and an empty list for none. */
export function Contact({ links }: { readonly links: readonly ContactLink[] | null }) {
  return (
    <div className="kb-acct kb-contact" aria-busy={links === null || undefined}>
      <h1 className="kb-acct-title kb-glass-display">Reach a person</h1>
      <div className="kb-acct-panel kb-calm">
        <p className="kb-acct-lead">The admins run this instance. Write to them if something looks broken, if you&apos;re stuck with no way out, or about anything that isn&apos;t part of the game.</p>
        {links !== null && links.length === 0 && <p className="kb-acct-text">This instance&apos;s admins haven&apos;t added a way to reach them yet.</p>}
        {links !== null && links.length > 0 && (
          <ul className="kb-contact-list">
            {links.map((l) => (
              <li key={`${l.label}|${l.href}`} className="kb-contact-item">
                {safe(l.href) ? <a href={l.href} rel="noopener noreferrer">{l.label}</a> : <span>{l.label}</span>}
                {safe(l.href) && address(l.href) !== null && <span className="kb-contact-address">{address(l.href)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The page at /contact: it reads the contact once, which is the same for every caller. */
export function ContactScreen() {
  const { api } = useKayfa();
  const [links, setLinks] = useState<readonly ContactLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void api.adminContact().then((l) => { if (live) setLinks(l); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api]);
  if (!failed) return <Contact links={links} />;
  return (
    <div className="kb-acct kb-contact">
      <h1 className="kb-acct-title kb-glass-display">Reach a person</h1>
      <div className="kb-acct-panel kb-calm">
        <p role="alert" className="kb-acct-refusal">The admins&apos; contact could not be read. Reload the page to try again.</p>
      </div>
    </div>
  );
}
