/**
 * Editing a post in place: the same box as the reply (toolbar, count, preview), saved as the post's
 * own character, whoever is in the HUD. Every edit is a public Act with a public history; an edit
 * within the grace period is kept as a version but does not set "Last edited", and this form says
 * so. Cancel leaves the post as it was; a refusal is shown in the server's words and the edit stays.
 */
import { useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { text as textOf } from '../thread/lines.tsx';
import { Editor } from './Editor.tsx';

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

export function EditPost({ act, seq, onDone, onSaved }: { readonly act: Act; readonly seq: number; readonly onDone: () => void; readonly onSaved: (act: Act) => void }) {
  const { api, settings } = useKayfa();
  const { characters } = usePlayer();
  const was = textOf(act.currentPayload.body);
  const [text, setText] = useState(was);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const name = characters.find((c) => c.id === act.character)?.name ?? 'this character';
  const over = [...text].length > settings.postMaxLength;

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || over || text.trim() === '' || text === was || act.character === null) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.edit(act.id, act.character, text);
      if (!answer.ok) { setRefusal(answer.error); return; }
      onSaved(answer.value);
      onDone();
    } catch {
      setRefusal('Your edit could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const grace = plural(settings.editGrace.count, settings.editGrace.unit);

  return (
    <form className="kb-edit-post" aria-label={`Edit post ${seq}`} onSubmit={(e) => void save(e)} noValidate>
      <p className="kb-small">Editing as <strong>{name}</strong></p>
      <Editor label="Your edit" value={text} onChange={setText} max={settings.postMaxLength} onSubmit={() => void save()} autoFocus>
        <button type="submit" className="kb-button" data-kb-primary="" disabled={busy || over || text.trim() === '' || text === was}>Save</button>
        <button type="button" className="kb-button" onClick={onDone}>Cancel</button>
      </Editor>
      <p className="kb-small kb-muted">Every version stays in History. An edit within {grace} of posting does not show “Last edited”.</p>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
    </form>
  );
}
