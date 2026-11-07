/**
 * phpBB's "Users browsing this thread", "Users browsing this board" and "Who is online", in the
 * board's world (the staff design, section 2; mock docs/research/2026-10-31-the-staff/mock-p1-presence.html):
 * a ruled box with a bold mono header and the names, joined by commas, each linked to its profile,
 * and past the cap "and N others".
 *
 * The viewer's own HUD mask, when it is hidden, is added in italics, "(hidden, only you see this)":
 * drawn from the player's own session (the HUD's mask), never from the answer, which lists no hidden
 * mask for anyone. The box is not a live region, so a screen reader is not interrupted at each poll.
 * A staff name is followed by the staff group's chip (the staff roster design, section 10).
 * It renders nothing until its first answer, or once its polls have stopped answering.
 */
import { useId, type ReactNode } from 'react';
import type { Presence, PresencePlace } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useKayfa } from '../context.tsx';
import { StaffGroup } from '../postbit/StaffBadge.tsx';
import { Link } from '../router.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import { usePresence } from './presence.ts';
import './presence.css';

export interface PresenceBoxProps {
  readonly place: PresencePlace;
  /** The box's heading. "Users browsing …" shortens to "Browsing …" on a phone, as the mock does. */
  readonly heading: string;
  /** A small muted line under the names ("Characters active in the past 5 minutes"). */
  readonly note?: string;
  /** The page document's copy of the box, shown at once with the reader's mask added, until the heartbeat's first answer replaces it. */
  readonly snapshot?: Presence;
}

const profile = (id: string) => `/c/${encodeURIComponent(id)}`;

export function PresenceBox({ place, heading, note, snapshot }: PresenceBoxProps) {
  const presence = usePresence(place, snapshot);
  const player = usePlayer();
  const { settings } = useKayfa();
  const id = useId();
  if (presence === null) return null;

  /* A Mod on a visit carries a glass tag after its name, linking to the post it visits (a visit is a public Act); on a thread's box only, which is where the answer names one. */
  const tag = (n: (typeof presence.names)[number]): ReactNode =>
    n.visitPost !== undefined && place.kind === 'thread'
      ? <Link className="kb-presence-visit" to={threadHref(place.thread, pageOf(n.visitPost, settings.postsPerPage), n.visitPost)}>On a visit · post #{n.visitPost}</Link>
      : null;
  const items: ReactNode[] = presence.names.map((n) =>
    n.staff && settings.staffGroup
      ? <span key={n.id}><Link to={profile(n.id)}>{n.name}</Link><span className="kb-visually-hidden">, </span><StaffGroup name={settings.staffGroup.name} />{tag(n)}</span>
      : <span key={n.id}><Link to={profile(n.id)}>{n.name}</Link>{tag(n)}</span>);
  const hud = player.hudCharacter;
  if (hud?.presenceHidden) {
    items.push(
      <em key="me" className="kb-presence-me">
        <Link to={profile(hud.id)}>{hud.name}</Link> (hidden<span className="kb-presence-wide">, only you see this</span>)
      </em>,
    );
  }
  const others = presence.others;
  const lead = /^Users (.+)$/u.exec(heading);

  return (
    <section className="kb-presence" aria-labelledby={id}>
      <h2 id={id} className="kb-presence-head">
        {lead ? <><span className="kb-presence-wide">{heading}</span><span className="kb-presence-narrow">{lead[1]![0]!.toUpperCase()}{lead[1]!.slice(1)}</span></> : heading}
      </h2>
      <p className="kb-presence-names">
        {items.length === 0 && others === 0 ? 'No characters right now.' : items.flatMap((item, i) => (i === 0 ? [item] : [', ', item]))}
        {others > 0 && <>{items.length > 0 ? ' and ' : ''}{others} {others === 1 ? 'other' : 'others'}</>}
        {note !== undefined && <><br /><span className="kb-small kb-muted">{note}</span></>}
      </p>
    </section>
  );
}
