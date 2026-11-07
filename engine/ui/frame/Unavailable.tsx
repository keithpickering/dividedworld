/**
 * The two error pages a screen draws in place of its content. "The page cannot be displayed" when a load fails, times out or
 * drops: the browser's own page, as a sheet inside the frame (white in light, charcoal in dark, its own colors and not the
 * theme's), with its glyph drawn in CSS, no image and no vendor's mark. And the forum's Information box when no page answers
 * to the address, naming what was asked for by the address's first segment (the routes' /t/, /b/ and /c/, web/src/App.tsx).
 * Both name their way out (the index, Try again, the browser's Back), and their words say what happened, never what to feel.
 * They draw inside `<main>`, as a screen does.
 */
import { useKayfa } from '../context.tsx';
import { Link } from '../router.tsx';
import './unavailable.css';

/** What each route's first segment asks for; any other address is just a page. */
const MISSING: Readonly<Record<string, string>> = {
  t: 'The thread you requested does not exist.',
  b: 'The board you requested does not exist.',
  c: 'The character you requested does not exist.',
};

/** The sentence for an address ("/t/x?page=2"): by its first segment, else that there is no page. */
export function missingMessage(address: string): string {
  const segment = address.split(/[?#]/, 1)[0]!.split('/')[1] ?? '';
  return Object.hasOwn(MISSING, segment) ? MISSING[segment]! : 'There is no page at this address.';
}

export function CannotDisplay({ address, onRetry }: { readonly address: string; readonly onRetry: () => void }) {
  const { ui } = useKayfa();
  return (
    <div className="kb-unavailable">
      <div className="kb-unavailable-sheet" role="group" aria-labelledby="kb-unavailable-heading">
      <div className="kb-unavailable-glyph" aria-hidden="true" />
      <div>
      <h1 id="kb-unavailable-heading">The page cannot be displayed</h1>
      <p>The page you are looking for is currently unavailable. {ui.copy.siteName} did not answer in time, or the connection dropped on the way.</p>
      <p>Please try the following:</p>
      <ul>
        <li>Click <button type="button" className="kb-unavailable-retry" onClick={onRetry}>Try again</button>, or try again in a moment.</li>
        <li>Check that your connection is working.</li>
        <li>Go <Link to="/">back to the index</Link>.</li>
        <li>Click your browser&apos;s Back button to return to the page you were on.</li>
      </ul>
      <p className="kb-unavailable-footer">Cannot load {address}</p>
      </div>
      </div>
    </div>
  );
}

export function CannotFind({ address }: { readonly address: string }) {
  return (
    <div className="kb-unavailable">
      <table className="kb-table kb-unavailable-info" aria-labelledby="kb-unavailable-band">
        <thead>
          <tr><td className="kb-bar" id="kb-unavailable-band">Information</td></tr>
        </thead>
        <tbody>
          <tr>
            <td className="kb-unavailable-message">
              <h1>{missingMessage(address)}</h1>
              <p>If you followed a link here, it may be mistyped or out of date.</p>
              <p><Link to="/">Click here to return to the index</Link></p>
            </td>
          </tr>
          <tr><td className="kb-unavailable-address">Address: {address}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
