/**
 * Laugh Track's settings in the play form (docs/plans/2026-11-11-laugh-track-design.md, section 6): up to five cue rows, each a phrase
 * and a sound, bounded as the card's rules bound them (cards/laugh-track.ts). Under each row a live line counts its places in this post's
 * own words through the rules' own `placesOf`, so the form and the server agree; under them the play's total against its cap. The count
 * is a preview; the server decides again. Above the rows a read-only copy of the post's words to select from: a selection fills the
 * phrase of the row that last had focus, trimmed to whole words by the same matcher. Typing a phrase stays a full path for a keyboard.
 */
import { useMemo, useRef, useState } from 'react';
import { occurrences } from '../../../../engine/bbcode/phrase.ts';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { PHRASE } from '../../cards/autocorrect.ts';
import { CUES, PLACES, placesOf, type Cue, type Sound } from '../../cards/laugh-track.ts';
import './laugh-track.css';

const SOUNDS: readonly { readonly value: Sound; readonly label: string }[] = [
  { value: 'laugh', label: 'Laugh' },
  { value: 'cheer', label: 'Cheer' },
  { value: 'boo', label: 'Boo' },
];
const BLANK: Cue = { phrase: '', sound: 'laugh' };
const isSound = (s: unknown): s is Sound => SOUNDS.some((o) => o.value === s);

const cuesOf = (config: ConfigFormProps['config']): Cue[] => {
  const raw = config?.cues;
  const cues = Array.isArray(raw)
    ? raw.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map((c) => ({ phrase: typeof c.phrase === 'string' ? c.phrase : '', sound: isSound(c.sound) ? c.sound : 'laugh' }))
      .slice(0, CUES.most)
    : [];
  return cues.length ? cues : [BLANK];
};

const places = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`;

/** A selection's words as whole words of the text: as selected, else without a first or last word that the selection cut short. */
function wholeWords(selected: string, text: string): string {
  const words = selected.trim().split(/\s+/u).filter(Boolean);
  const tries = [words, words.slice(1), words.slice(0, -1), words.slice(1, -1)];
  for (const t of tries) {
    const phrase = t.join(' ');
    if (phrase && [...phrase].length <= PHRASE.most && occurrences(text, phrase).length > 0) return phrase;
  }
  return '';
}

export function ConfigForm({ config, onChange, post, id }: ConfigFormProps) {
  const [cues, setCues] = useState<Cue[]>(() => cuesOf(config));
  const lastFocused = useRef(0);
  const body = typeof post.currentPayload?.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  const all = useMemo(() => placesOf(text, cues), [text, cues]);
  const counts = useMemo(() => cues.map((_, i) => all.filter((p) => p.cue === i).length), [all, cues]);

  const set = (next: Cue[]) => {
    setCues(next);
    onChange({ cues: next });
  };
  const edit = (i: number, patch: Partial<Cue>) => set(cues.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const read = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const phrase = wholeWords(sel.toString(), text);
    if (phrase) edit(Math.min(lastFocused.current, cues.length - 1), { phrase });
  };
  const remove = (i: number) => {
    if (lastFocused.current >= i) lastFocused.current = Math.max(0, lastFocused.current - 1);
    set(cues.filter((_, j) => j !== i));
  };

  return (
    <fieldset className="dw-lt-form">
      <legend className="dw-lt-form-legend">Your audience&apos;s cues</legend>
      <blockquote
        className="dw-lt-form-copy" aria-label="The post's words, to select from" tabIndex={0}
        onMouseUp={read} onKeyUp={read} onTouchEnd={read}
      >
        {text}
      </blockquote>
      {cues.map((cue, i) => (
        <div key={i} className="dw-lt-form-row">
          <div className="dw-lt-form-fields">
            <label htmlFor={`${id}-phrase-${i}`} className="dw-lt-form-label">Phrase</label>
            <input
              id={`${id}-phrase-${i}`} type="text" value={cue.phrase} maxLength={PHRASE.most} autoComplete="off" spellCheck={false}
              aria-describedby={`${id}-places-${i}`} onFocus={() => { lastFocused.current = i; }}
              onChange={(e) => edit(i, { phrase: e.target.value })}
            />
            <label htmlFor={`${id}-sound-${i}`} className="dw-lt-form-label">Sound</label>
            <select
              id={`${id}-sound-${i}`} value={cue.sound} onFocus={() => { lastFocused.current = i; }}
              onChange={(e) => edit(i, { sound: e.target.value as Sound })}
            >
              {SOUNDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {cues.length > 1 && (
              <button type="button" className="dw-lt-form-remove" aria-label={`Remove cue ${i + 1}`} onClick={() => remove(i)}>Remove</button>
            )}
          </div>
          <p id={`${id}-places-${i}`} role="status" className="dw-lt-form-places">
            {counts[i] ? `Cues ${places(counts[i]!)} in this post` : 'Not in this post\'s own words'}
          </p>
          {i === 0 && <p className="dw-lt-form-note">A face-down Laugh Track waits for this phrase</p>}
        </div>
      ))}
      {cues.length < CUES.most && (
        <button type="button" className="dw-lt-form-add" onClick={() => set([...cues, BLANK])}>Add a cue</button>
      )}
      <p className="dw-lt-form-total">{places(all.length)} in all (at most {PLACES.most})</p>
    </fieldset>
  );
}
