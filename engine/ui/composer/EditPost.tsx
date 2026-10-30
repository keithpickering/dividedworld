/**
 * Editing a post in place: the same box as the reply (toolbar, count, preview), saved as the post's
 * own character, whoever is in the HUD. Every edit is a public Act with a public history; an edit
 * within the grace period is kept as a version but does not set "Last edited", and this form says
 * so. Cancel (or Esc) leaves the post as it was; a refusal is shown in the server's words and the
 * edit stays. An answer that never came back is looked for in the post's History before the edit is
 * offered again ("Save again anyway"), because an edit is an Act and a blind resend is a second one.
 */
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
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
  const [again, setAgain] = useState(false);
  const name = characters.find((c) => c.id === act.character)?.name ?? 'this character';
  const over = [...text].length > settings.postMaxLength;

  /* The edit is in: the post as it stands now is shown. */
  const landed = async () => {
    const now = await api.act(act.id).catch(() => null);
    if (now) onSaved(now);
    onDone();
  };
  /* No answer came back: the latest version in the History says whether the edit went through. */
  const look = async (words: string | null, character: Id) => {
    let found = false;
    let looked = true;
    try {
      const versions = await api.history(act.id);
      const last = versions.at(-1);
      found = last !== undefined && last.kind === 'edit' && last.character === character && textOf(last.payload.body) === text;
    } catch { looked = false; }
    if (found) { await landed(); return; }
    setAgain(true);
    setRefusal(`${words ?? 'No answer came back.'} ${looked ? 'Your edit is not in the History yet.' : 'The History could not be checked for it.'} Press “Save again anyway” to save it again.`);
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || over || text.trim() === '' || text === was || act.character === null) return;
    const character = act.character;
    setBusy(true);
    setRefusal(null);
    try {
      let answer;
      try { answer = await api.edit(act.id, character, text); } catch { await look(null, character); return; }
      if (answer.ok) { onSaved(answer.value); onDone(); }
      else if (answer.uncertain) await look(answer.error, character);
      else setRefusal(answer.error);
    } finally {
      setBusy(false);
    }
  };
  const change = (next: string) => {
    setText(next);
    if (again) { setAgain(false); setRefusal(null); }
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } };
  const grace = plural(settings.editGrace.count, settings.editGrace.unit);

  return (
    <form className="kb-edit-post" aria-label={`Edit post ${seq}`} onSubmit={(e) => void save(e)} onKeyDown={key} noValidate>
      <p className="kb-small">Editing as <strong>{name}</strong></p>
      <Editor label="Your edit" value={text} onChange={change} max={settings.postMaxLength} submitVerb="saves" onSubmit={() => void save()} autoFocus>
        <button type="submit" className="kb-button" data-kb-primary="" disabled={busy || over || text.trim() === '' || text === was}>{again ? 'Save again anyway' : 'Save'}</button>
        <button type="button" className="kb-button" onClick={onDone}>Cancel</button>
      </Editor>
      <p className="kb-small kb-muted">Every version stays in History. An edit within {grace} of posting does not show “Last edited”.</p>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
    </form>
  );
}
