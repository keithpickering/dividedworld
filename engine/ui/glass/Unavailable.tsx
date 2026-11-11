/**
 * The two error screens the glass draws in place of a page's content (the glass-load plan, Task 4): "This screen didn't
 * load" when a load fails, times out or drops, and "There's nothing here" when no screen answers to the address. They sit in
 * the glass's head and a cut panel, in the glass's own voice, and they name no address: the ids an address carries are
 * the reader's, and a screen that says them back says more than the reader asked. The frame's own pair (frame/Unavailable.tsx)
 * stays for the board; Routes draws these when the app gives them (its `failures`).
 */
import type { ReactNode } from 'react';
import { CONTACT_PATH } from '../contact/Contact.tsx';
import { LOAD_LIMIT_MS } from '../router.tsx';
import type { DisplayFailure } from '../routes.tsx';
import { GlassButton } from './Button.tsx';
import { GlassLink } from './Link.tsx';
import { PageHead } from './PageHead.tsx';
import { useBackToBoard } from './back.ts';
import './unavailable.css';

const LIMIT_SECONDS = LOAD_LIMIT_MS / 1000;

/** The words by cause. `broken` is the page's own code failing; its words are a draft the owner reads in review. */
function words(kind: DisplayFailure): { readonly title: string; readonly lead: ReactNode } {
  const admin = <GlassLink to={CONTACT_PATH}>tell an admin</GlassLink>;
  switch (kind) {
    case 'offline':
      return { title: "You're offline", lead: 'Your device reports no connection, so nothing was sent. Reconnect, then try again.' };
    case 'silent':
      return { title: "This screen didn't load", lead: `The server didn't answer within ${LIMIT_SECONDS} seconds, or the connection dropped on the way. Loading a screen changes nothing, so nothing was lost.` };
    case 'server':
      return { title: "This screen didn't load", lead: <>The server answered with an error. Your connection is fine, and nothing was lost. Try again in a moment. If it keeps happening, {admin}.</> };
    case 'broken':
      return { title: "This screen didn't load", lead: <>Something went wrong while loading it. Nothing was lost. Try again, and if it keeps happening, {admin}.</> };
  }
}

export function GlassCannotDisplay({ kind, onRetry }: { readonly kind: DisplayFailure; readonly onRetry: () => void }) {
  const back = useBackToBoard();
  const { title, lead } = words(kind);
  return (
    <section className="kb-glass-cut-panel kb-glass-unavailable-panel">
      <PageHead
        title={title}
        lead={lead}
        actions={<>
          <GlassButton kind="primary" onClick={onRetry}>Try again</GlassButton>
          <GlassButton kind="secondary" onClick={back}>Back to the board</GlassButton>
        </>}
      />
    </section>
  );
}

export function GlassCannotFind() {
  const back = useBackToBoard();
  return (
    <section className="kb-glass-cut-panel kb-glass-unavailable-panel">
      <PageHead
        title="There's nothing here"
        lead="Nothing on this address can be shown: it may never have existed, or it has gone."
        actions={<GlassButton kind="primary" onClick={back}>Back to the board</GlassButton>}
      />
    </section>
  );
}
