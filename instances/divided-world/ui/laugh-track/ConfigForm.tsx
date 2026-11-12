/**
 * Laugh Track's settings in the play form (docs/plans/2026-11-11-laugh-track-design.md, section 6): up to five cue rows, each a phrase
 * and a sound, bounded as the card's rules bound them (cards/laugh-track.ts). Under each row a live line counts its places in this post's
 * own words through the rules' own `placesOf`, so the form and the server agree; under them the play's total against its cap. The count
 * is a preview; the server decides again. Above the rows a read-only copy of the post's words to select from: a selection fills the
 * phrase of the row that last had focus, trimmed to whole words by the same matcher; the selection is read on `selectionchange` and only
 * when it lies wholly inside the copy. A row out of the rules' bounds says so in the rules' own refusal words (`validateConfig` on that one cue). Typing a phrase stays a full path for a keyboard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { occurrences } from '../../../../engine/bbcode/phrase.ts';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { PHRASE } from '../../cards/autocorrect.ts';
import { CUES, PLACES, laughTrack, placesOf, type Cue, type Sound } from '../../cards/laugh-track.ts';
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

/** Why a phrase is out of the card's bounds, in the rules' own words, asked of the rules' `validateConfig` so the two cannot drift; undefined within them. */
function boundOf(phrase: string): string | undefined {
  const verdict = laughTrack.validateConfig({ cues: [{ phrase, sound: 'laugh' }] });
  return verdict.ok ? undefined : `${verdict.why.charAt(0).toUpperCase()}${verdict.why.slice(1)}`;
}

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
  const serial = useRef(0);
  const nextKey = () => serial.current++;
  const [rows, setRows] = useState<{ key: number; cue: Cue }[]>(() => cuesOf(config).map((cue) => ({ key: nextKey(), cue })));
  const cues = useMemo(() => rows.map((r) => r.cue), [rows]);
  const lastFocused = useRef(0);
  const refocus = useRef<number | null>(null);
  const copy = useRef<HTMLQuoteElement>(null);
  const body = typeof post.currentPayload?.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  const all = useMemo(() => placesOf(text, cues), [text, cues]);
  const counts = useMemo(() => cues.map((_, i) => all.filter((p) => p.cue === i).length), [all, cues]);

  const set = (next: { key: number; cue: Cue }[]) => {
    setRows(next);
    onChange({ cues: next.map((r) => r.cue) });
  };
  const edit = (i: number, patch: Partial<Cue>) => set(rows.map((r, j) => (j === i ? { ...r, cue: { ...r.cue, ...patch } } : r)));
  const latest = useRef({ text, rows, edit });
  latest.current = { text, rows, edit };

  /* A selection wholly inside the copy fills the row that last had focus; one made elsewhere, or running past the copy's edges, fills nothing. */
  useEffect(() => {
    const read = () => {
      const el = copy.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      const phrase = wholeWords(range.toString(), latest.current.text);
      if (phrase) latest.current.edit(Math.min(lastFocused.current, latest.current.rows.length - 1), { phrase });
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  /* After a removal the clicked button is gone: focus goes to the Phrase of the row now at that place, once it is drawn. */
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const row = rows[at];
    if (row) document.getElementById(`${id}-phrase-${row.key}`)?.focus();
  });

  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    if (lastFocused.current > i) lastFocused.current -= 1;
    lastFocused.current = Math.min(lastFocused.current, next.length - 1);
    refocus.current = Math.min(i, next.length - 1);
    set(next);
  };

  return (
    <fieldset className="dw-lt-form">
      <legend className="dw-lt-form-legend">Your audience&apos;s cues</legend>
      <blockquote ref={copy} className="dw-lt-form-copy" aria-label="The post's words, to select from" tabIndex={0}>
        {text}
      </blockquote>
      {rows.map(({ key, cue }, i) => {
        const bound = cue.phrase.trim() ? boundOf(cue.phrase) : undefined;
        return (
          <div key={key} className="dw-lt-form-row">
            <div className="dw-lt-form-fields">
              <label htmlFor={`${id}-phrase-${key}`} className="dw-lt-form-label">
                Phrase<span className="dw-lt-form-hidden"> for cue {i + 1}</span>
              </label>
              <input
                id={`${id}-phrase-${key}`} type="text" value={cue.phrase} maxLength={PHRASE.most} autoComplete="off" spellCheck={false}
                aria-describedby={`${id}-places-${key}`} onFocus={() => { lastFocused.current = i; }}
                onChange={(e) => edit(i, { phrase: e.target.value })}
              />
              <label htmlFor={`${id}-sound-${key}`} className="dw-lt-form-label">
                Sound<span className="dw-lt-form-hidden"> for cue {i + 1}</span>
              </label>
              <select
                id={`${id}-sound-${key}`} value={cue.sound} onFocus={() => { lastFocused.current = i; }}
                onChange={(e) => edit(i, { sound: e.target.value as Sound })}
              >
                {SOUNDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {rows.length > 1 && (
                <button type="button" className="dw-lt-form-remove" aria-label={`Remove cue ${i + 1}`} onClick={() => remove(i)}>Remove</button>
              )}
            </div>
            <p id={`${id}-places-${key}`} className="dw-lt-form-places">
              {!cue.phrase.trim() ? `At least ${PHRASE.least} letters or digits, matched as whole words in any case`
                : bound ?? (counts[i] ? `Cues ${places(counts[i]!)} in this post` : 'Not in this post\'s own words')}
            </p>
            {i === 0 && <p className="dw-lt-form-note">A face-down Laugh Track waits for this phrase</p>}
          </div>
        );
      })}
      {rows.length < CUES.most && (
        <button type="button" className="dw-lt-form-add" onClick={() => set([...rows, { key: nextKey(), cue: BLANK }])}>Add a cue</button>
      )}
      <p role="status" className="dw-lt-form-total">{places(all.length)} in all (at most {PLACES.most})</p>
    </fieldset>
  );
}
