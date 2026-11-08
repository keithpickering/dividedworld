/**
 * The glass's own words on the two posts a group move makes in a thread (docs/plans/2026-11-06-member-groups-plan.md, Task 10): the plain line under a `conferGroup` move's label
 * ("A Mod put Pipewrench in Trial Members, barred from posting on General."), and the label over a ruling on an apology (a post by the move's staff member whose payload
 * carries `ruling`). Both are the engine's and true; the staff member's words under them are its own and may bluff. The names come from the instance's rows (the character, the
 * group in `ScreenSettings.groups`, the board), since the Act holds only ids and a key.
 */
import { useEffect, useState } from 'react';
import { moveKind } from '../../system/moves.ts';
import { officeRole } from '../board/move-words.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Office } from '../data/api.ts';

/** The ruling a post carries, or null for a post that rules on nothing. Only the two the judge writes are labels; `returned` writes no post. */
export const rulingOf = (act: Act): 'accepted' | 'rejected' | null =>
  act.kind === 'post' && (act.payload['ruling'] === 'accepted' || act.payload['ruling'] === 'rejected') ? act.payload['ruling'] : null;

/** The label over a ruling, in the move's label style (`kb-move-tag`): plain capitals set by the style, the words the engine's. */
export function RulingTag({ ruling }: { readonly ruling: 'accepted' | 'rejected' }) {
  return (
    <span className="kb-move-tag" data-kb-ruling-tag={ruling}>
      <span className="kb-move-label">{ruling === 'accepted' ? 'Apology accepted' : 'Apology rejected'}</span>
    </span>
  );
}

/** A group move as one plain sentence under its label, once the character and the board have been named. Nothing is drawn for a kind with no names to fill. */
export function GroupMoveLine({ act, office }: { readonly act: Act; readonly office: Office | undefined }) {
  const { api, ui, settings } = useKayfa();
  const kind = typeof act.payload['kind'] === 'string' ? act.payload['kind'] : '';
  const params = (act.payload['params'] ?? {}) as Readonly<Record<string, unknown>>;
  const [names, setNames] = useState<{ readonly character?: string; readonly board?: string } | null>(null);
  useEffect(() => {
    if (kind !== 'conferGroup') return;
    let live = true;
    void (async () => {
      const [who, boards] = await Promise.all([
        typeof params['character'] === 'string' ? api.characters([params['character']]).then((r) => r[0]?.name, () => undefined) : undefined,
        api.boardNames().then((b) => b, () => []),
      ]);
      const board = boards.find((b) => b.id === params['board'])?.name;
      if (live) setNames({ ...(who !== undefined ? { character: who } : {}), ...(board !== undefined ? { board } : {}) });
    })();
    return () => { live = false; };
  // The Act is append-only: its params never change under a mounted post.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, act.id, kind]);
  const move = moveKind(kind);
  if (kind !== 'conferGroup' || !move || names === null) return null;
  const group = settings.groups.find((g) => g.key === params['group'])?.name;
  return <p className="kb-move-plain kb-small">{move.template(params, officeRole(ui.copy, office), { ...names, ...(group !== undefined ? { group } : {}) })}</p>;
}
