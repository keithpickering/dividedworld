/**
 * The two error pages a screen draws in place of its content (the forum-load plan, Task 9): "The page cannot be
 * displayed" when a load fails, times out or drops, and "The page cannot be found" when no page answers to the
 * address. They draw inside `<main>`, as a screen does, in the frame's own type and rules; the glyph is drawn in CSS,
 * with no image and no vendor's mark. Their words are plain, and they say what happened, never what to feel.
 */
import { useKayfa } from '../context.tsx';
import { Link } from '../router.tsx';
import './unavailable.css';

export function CannotDisplay({ address, onRetry }: { readonly address: string; readonly onRetry: () => void }) {
  const { ui } = useKayfa();
  return (
    <div className="kb-unavailable">
      <div className="kb-unavailable-glyph" aria-hidden="true" />
      <h1>The page cannot be displayed</h1>
      <hr className="kb-unavailable-rule" />
      <p>The page you are looking for is currently unavailable. {ui.copy.siteName} did not answer in time, or the connection dropped on the way.</p>
      <p>Please try the following:</p>
      <ul>
        <li>Click <button type="button" className="kb-unavailable-retry" onClick={onRetry}>Try again</button>, or try again in a moment.</li>
        <li>Check that your connection is working.</li>
        <li>Go <Link to="/">back to the index</Link>.</li>
        <li>Click your browser&apos;s Back button to return to the page you were on.</li>
      </ul>
      <hr className="kb-unavailable-rule" />
      <p className="kb-unavailable-footer">Cannot load {address}</p>
    </div>
  );
}

export function CannotFind({ address }: { readonly address: string }) {
  return (
    <div className="kb-unavailable">
      <div className="kb-unavailable-glyph" aria-hidden="true" />
      <h1>The page cannot be found</h1>
      <hr className="kb-unavailable-rule" />
      <p>The page you are looking for might have been removed, had its name changed, or never existed.</p>
      <p>Please try the following:</p>
      <ul>
        <li>If you typed the page address, make sure that it is spelled correctly.</li>
        <li>Open the <Link to="/">index</Link>, and then look for links to the page you want.</li>
        <li>Click your browser&apos;s Back button to try another link.</li>
      </ul>
      <hr className="kb-unavailable-rule" />
      <p className="kb-unavailable-footer">Page not found: {address}</p>
    </div>
  );
}
