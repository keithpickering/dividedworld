/**
 * A move as one short plain sentence, with the boards it names as links ("Renamed General to Pointless Toast Palace"): the engine's
 * words for it (engine/system/moves.ts `parts`), a board's link made from its id. A board the page does not know is named, not linked.
 */
import type { BoardName } from '../data/api.ts';
import { Link } from '../router.tsx';
import { moveParts } from './move-words.ts';

export function MoveSentence({ kind, params, boards, tense, was }: {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly boards: readonly BoardName[];
  readonly tense: 'done' | 'plan';
  /** The name the board had, where the caller knows it better than `boards` (a board renamed again since). */
  readonly was?: string | null;
}) {
  const named = boards.find((b) => b.id === params['board']);
  const parts = moveParts(kind, params, was ?? named?.was ?? null, tense);
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <span key={i}>{p}</span>;
        const b = boards.find((x) => x.id === p.board);
        return b ? <Link key={i} to={`/b/${encodeURIComponent(b.slug)}`}>{p.name}</Link> : <span key={i}>{p.name}</span>;
      })}
    </>
  );
}
