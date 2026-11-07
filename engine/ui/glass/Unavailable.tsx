/**
 * The two error screens the glass draws in place of a page's content (the glass-load plan, Task 4): "This screen didn't
 * load" when a load fails, times out or drops, and "There's nothing here" when no screen answers to the address. They sit in
 * the glass's head and a cut panel, in the glass's own voice, and they name no address: the ids an address carries are
 * the reader's, and a screen that says them back says more than the reader asked. The frame's own pair (frame/Unavailable.tsx)
 * stays for the board; Routes draws these when the app gives them (its `failures`).
 */
import { ButtonRow, GlassButton } from './Button.tsx';
import { PageHead } from './PageHead.tsx';
import { useBackToBoard } from './back.ts';
import './unavailable.css';

export function GlassCannotDisplay({ onRetry }: { readonly onRetry: () => void }) {
  const back = useBackToBoard();
  return (
    <section className="kb-glass-cut-panel kb-glass-unavailable-panel">
      <PageHead
        title="This screen didn't load"
        lead="The server didn't answer, or it took longer than 20 seconds. Loading a screen changes nothing, so nothing was lost."
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
        actions={<ButtonRow><GlassButton kind="primary" onClick={back}>Back to the board</GlassButton></ButtonRow>}
      />
    </section>
  );
}
