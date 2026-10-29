/** "↳ Spun into: ..." under an Act that threads were spun from. */
import type { Id } from '../data/api.ts';
import { Link } from '../router.tsx';
import { useSpunInto } from './spun.ts';

export function SpunInto({ act }: { readonly act: Id }) {
  const threads = useSpunInto(act);
  if (threads.length === 0) return null;
  return (
    <p className="kb-spun kb-small">
      ↳ Spun into:{' '}
      {threads.map((t, i) => (
        <span key={t.id}>
          {i > 0 && ' · '}
          <Link to={`/t/${t.id}`}>{t.title}</Link> ({t.replies} {t.replies === 1 ? 'reply' : 'replies'})
        </span>
      ))}
    </p>
  );
}
