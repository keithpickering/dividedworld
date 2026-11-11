/**
 * A move as one short plain sentence, with the boards it names as links ("Renamed General to Pointless Toast Palace"): the engine's
 * words for it (engine/system/moves.ts `parts`), a board's link made from its id. A board the page does not know is named, not linked.
 */
import { useKayfa } from '../context.tsx';
import type { BoardName } from '../data/api.ts';
import { Link } from '../router.tsx';
import { moveParts } from './move-words.ts';

export function MoveSentence({ kind, params, boards, tense, was, bosses, unnamed, character, thread }: {
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
  /** The thread a `moveThread` moved, by its title now, and the board it left, where the caller knows them (the params hold only ids); absent, the sentence says "a thread". */
  readonly thread?: { readonly title: string; readonly from?: BoardName };
}) {
  const { settings } = useKayfa();
  const named = boards.find((b) => b.id === params['board']);
  /* A merge names two boards: `board` is the one that closes (read by `was`, its name now), `into` the one that takes its threads (the sentence's second board). */
  const merged = kind === 'mergeBoard';
  const target = merged ? boards.find((b) => b.id === params['into']) : named;
  const boss = kind === 'nameSuccessor' ? bosses?.find((b) => b.staff === params['boss'])?.name ?? unnamed : undefined;
  /* A group move names its group by the instance's name for it (the params hold the key) and its board by the board's name now. */
  const group = settings.groups.find((g) => g.key === params['group'])?.name;
  const names = {
    ...(character !== undefined ? { character } : {}), ...(group !== undefined ? { group } : {}), ...(target ? { board: target.name } : {}),
    ...(thread ? { thread: thread.title, ...(thread.from ? { from: thread.from.name, fromId: thread.from.id } : {}) } : {}),
  };
  const parts = moveParts(kind, params, was ?? boss ?? (merged ? named?.name : named?.was) ?? null, tense, names);
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
