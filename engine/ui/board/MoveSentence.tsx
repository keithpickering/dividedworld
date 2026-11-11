/**
 * A move as one short plain sentence, with the boards it names as links ("Renamed General to Pointless Toast Palace"): the engine's
 * words for it (engine/system/moves.ts `parts`), a board's link made from its id. A board the page does not know is named, not linked.
 */
import { useKayfa } from '../context.tsx';
import type { BoardName } from '../data/api.ts';
import { Link } from '../router.tsx';
import { moveBoardNames, moveParts } from './move-words.ts';
import { useMovedThread } from './moved-thread.ts';

export function MoveSentence({ kind, params, boards, tense, was, bosses, unnamed, character, act }: {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly boards: readonly BoardName[];
  readonly tense: 'done' | 'plan';
  /** The name the board had, where the caller knows it better than `boards` (a board renamed again since). */
  readonly was?: string | null;
  /** The roster's Bosses, so a move that names one reads with its name and not its key. */
  readonly bosses?: readonly { readonly staff: string; readonly name: string }[];
  /** What a nominated Boss is called when `bosses` does not know it (a persona that has not debuted); its key is never shown. */
  readonly unnamed?: string;
  /** The character a group move names, where the caller knows it (the params hold only its id); absent, the sentence says "a member". */
  readonly character?: string;
  /** The move's Act where it has landed, so a thread move names the board it left as it was then; a waiting move has none. */
  readonly act?: string | null;
}) {
  const { settings } = useKayfa();
  const named = boards.find((b) => b.id === params['board']);
  const boss = kind === 'nameSuccessor' ? bosses?.find((b) => b.staff === params['boss'])?.name ?? unnamed : undefined;
  /* A group move names its group by the instance's name for it (the params hold the key) and its board by the board's name now. */
  const group = settings.groups.find((g) => g.key === params['group'])?.name;
  const moved = useMovedThread(kind, params, act, boards);
  const names = { ...(character !== undefined ? { character } : {}), ...(group !== undefined ? { group } : {}), ...moveBoardNames(kind, params, boards), ...(moved ?? {}) };
  /* A merge's source board is read by its name now; a rename's by the name it had before the move. */
  const parts = moveParts(kind, params, was ?? boss ?? (kind === 'mergeBoard' ? names.source : named?.was) ?? null, tense, names);
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
