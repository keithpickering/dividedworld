/**
 * "↳ Spun into: ..." in the foot of an Act that threads were spun from, under its action buttons: the first few, then "and N more",
 * a button that reads that Act's whole list (up to `SPUN_FROM_MAX`) when pressed. It is out of the post's content area, so no effect
 * drawn on the post covers it or is sized around it.
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import { SPUN_FROM_MAX, type Id, type ThreadSummary } from '../data/api.ts';
import { Link } from '../router.tsx';
import { useSpunInto } from './spun.ts';

export function SpunInto({ act }: { readonly act: Id }) {
  const { api } = useKayfa();
  const spun = useSpunInto(act);
  const [all, setAll] = useState<readonly ThreadSummary[] | null>(null);
  const [state, setState] = useState<'idle' | 'reading' | 'failed'>('idle');
  const threads = all ?? spun.threads;
  if (threads.length === 0) return null;

  const readAll = () => {
    setState('reading');
    api.spunFrom(act).then((list) => { setAll(list); setState('idle'); }, () => setState('failed'));
  };
  const rest = `${spun.more}${spun.atLeast ? ' or more' : ''}`;
  return (
    <p className="kb-spun">
      ↳ Spun into:{' '}
      {threads.map((t, i) => (
        <span key={t.id}>
          {i > 0 && ' · '}
          <Link to={`/t/${t.id}`}>{t.title}</Link> ({t.replies} {t.replies === 1 ? 'reply' : 'replies'})
        </span>
      ))}
      {all === null && spun.more > 0 && (
        <>
          {' · '}
          <button type="button" className="kb-link-button" disabled={state === 'reading'} aria-label={`Show the other ${rest} threads spun from this Act`} onClick={readAll}>and {rest} more</button>
          {state === 'failed' && <span role="status"> The rest could not be read. Press to try again.</span>}
        </>
      )}
      {all !== null && all.length >= SPUN_FROM_MAX && <span> · The first {SPUN_FROM_MAX} are listed.</span>}
    </p>
  );
}
