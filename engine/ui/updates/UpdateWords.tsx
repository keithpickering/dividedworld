/**
 * An update's words as a page shows them, shared by the Updates page and the ORIGIN box of a thread spun from one: the prose (BBCode, a blank line
 * apart, never markup) and the plain "What changed" list. The page's own copy of the update is the typed `Update`; the box has only the Act, whose
 * payload is `{ title, body, changes }`, so `updateOf` reads one defensively (a payload the server's constraint would have refused is shown as far as it
 * goes, never thrown on).
 */
import { BbCode } from '../bbcode/render.tsx';
import type { Act, UpdateChange } from '../data/api.ts';

export function Prose({ body }: { readonly body: string }) {
  return (
    <div className="kb-updates-prose">
      {body.split(/\n\s*\n/u).filter((p) => p.trim() !== '').map((p, i) => <BbCode key={i} text={p} />)}
    </div>
  );
}

/** `label` names the list where no heading above it does (the ORIGIN box); under the Updates page's "What changed" heading it is left off, so it is not announced twice. */
export function ChangedList({ changes, label }: { readonly changes: readonly UpdateChange[]; readonly label?: string }) {
  return (
    <ul className="kb-updates-changes" aria-label={label}>
      {changes.map((c, i) => <li key={i}>{c.label !== '' && <><b>{c.label}</b>{' '}</>}{c.text}</li>)}
    </ul>
  );
}

/** The title, words and changes of an `update` Act, as its payload holds them. */
export function updateOf(act: Act): { readonly title: string; readonly body: string; readonly changes: readonly UpdateChange[] } {
  const p = act.payload;
  const changes = Array.isArray(p['changes']) ? (p['changes'] as unknown[]) : [];
  return {
    title: typeof p['title'] === 'string' ? p['title'] : '',
    body: typeof p['body'] === 'string' ? p['body'] : '',
    changes: changes.flatMap((c) => {
      const row = c as { label?: unknown; text?: unknown } | null;
      return row !== null && typeof row === 'object' && typeof row.text === 'string' ? [{ label: typeof row.label === 'string' ? row.label : '', text: row.text }] : [];
    }),
  };
}
