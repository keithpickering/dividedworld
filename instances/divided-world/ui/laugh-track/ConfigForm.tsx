/**
 * Laugh Track's settings in the play form (docs/plans/2026-11-12-laugh-track-band-design.md, section 5): up to five cues, each a phrase and a
 * sound, bounded as the card's rules bound them (cards/laugh-track.ts), drawn in the glass's own pieces (engine/ui/cards/config). A cue's hint
 * counts its places in this post's own words through the rules' own `placesOf`, so the form and the server agree; the count is a preview and
 * the server decides again. A phrase out of the rules' bounds is refused in the rules' own words (`validateConfig` on that one cue). Under the
 * cues sit the play's total against its cap and "Add a cue".
 *
 * The post's words are shown to select from. A selection never overwrites: it fills the first cue whose phrase is empty (trimmed to whole
 * words by the same matcher), else adds a cue while there are fewer than five, else changes nothing and the total's live region says all five
 * are filled, until a cue is cleared or removed. Typing a phrase stays a full path for a keyboard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { occurrences } from '../../../../engine/bbcode/phrase.ts';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import { ConfigChoice } from '../../../../engine/ui/cards/config/ConfigChoice.tsx';
import { ConfigField } from '../../../../engine/ui/cards/config/ConfigField.tsx';
import { ConfigHint } from '../../../../engine/ui/cards/config/ConfigHint.tsx';
import { PostWords } from '../../../../engine/ui/cards/config/PostWords.tsx';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { GlassButton } from '../../../../engine/ui/glass/Button.tsx';
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

type Row = { key: number; cue: Cue };

export function ConfigForm({ config, onChange, post, id }: ConfigFormProps) {
  const serial = useRef(0);
  const nextKey = () => serial.current++;
  const [rows, setRows] = useState<Row[]>(() => cuesOf(config).map((cue) => ({ key: nextKey(), cue })));
  const [full, setFull] = useState(false);
  const cues = useMemo(() => rows.map((r) => r.cue), [rows]);
  const refocus = useRef<number | null>(null);
  const form = useRef<HTMLFieldSetElement>(null);
  const body = typeof post.currentPayload?.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  const all = useMemo(() => placesOf(text, cues), [text, cues]);
  const counts = useMemo(() => cues.map((_, i) => all.filter((p) => p.cue === i).length), [all, cues]);

  /* The rows as the last change left them, so two selections before a draw each see the other's work. */
  const current = useRef(rows);
  const set = (next: Row[]) => {
    current.current = next;
    setRows(next);
    setFull(false);
    onChange({ cues: next.map((r) => r.cue) });
  };
  const edit = (i: number, patch: Partial<Cue>) => set(current.current.map((r, j) => (j === i ? { ...r, cue: { ...r.cue, ...patch } } : r)));

  /* After a removal the clicked button is gone, and after an add the new cue wants the cursor: focus goes to the Phrase of the cue now at that place, once it is drawn. */
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const row = rows[at];
    if (row) document.getElementById(`${id}-phrase-${row.key}`)?.focus();
  });

  const remove = (i: number) => {
    const next = current.current.filter((_, j) => j !== i);
    refocus.current = Math.min(i, next.length - 1);
    set(next);
  };
  const add = () => {
    const next = [...current.current, { key: nextKey(), cue: BLANK }];
    refocus.current = next.length - 1;
    set(next);
  };

  /* A selection fills the first cue with an empty phrase, else adds a cue, else (five filled) changes nothing and says so. */
  const fill = (selected: string) => {
    const phrase = wholeWords(selected, text);
    if (!phrase) return;
    const rs = current.current;
    const empty = rs.findIndex((r) => r.cue.phrase.trim() === '');
    if (empty >= 0) edit(empty, { phrase });
    else if (rs.length < CUES.most) set([...rs, { key: nextKey(), cue: { ...BLANK, phrase } }]);
    else setFull(true);
  };

  return (
    <fieldset ref={form} className="kb-play-choice" style={{ display: 'flex', flexDirection: 'column', gap: 16, border: 0, margin: 0, padding: 0 }}>
      <legend className="kb-play-label">Your audience&apos;s cues</legend>
      <div>
        <ConfigHint>Select words in the post below with a pointer or by touch, or type them. A selection fills the first empty cue.</ConfigHint>
        <PostWords words={text} within={form} onSelect={fill} />
      </div>
      {rows.map(({ key, cue }, i) => {
        const bound = cue.phrase.trim() ? boundOf(cue.phrase) : undefined;
        const line = !cue.phrase.trim() ? `At least ${PHRASE.least} letters or digits, matched as whole words in any case`
          : bound ? undefined : counts[i] ? `Cues ${places(counts[i]!)} in this post` : 'Not in this post\'s own words';
        const hint = i === 0
          ? `${line === undefined ? '' : `${line}. `}A face-down Laugh Track waits for this phrase.`
          : line;
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ConfigField
              id={`${id}-phrase-${key}`}
              label={`Cue ${i + 1}`}
              value={cue.phrase}
              maxLength={PHRASE.most}
              onChange={(phrase) => edit(i, { phrase })}
              hint={hint}
              why={bound}
              action={rows.length > 1 ? (
                <GlassButton kind="quiet" size="s" aria-label={`Remove cue ${i + 1}`} onClick={() => remove(i)}>Remove</GlassButton>
              ) : undefined}
            />
            <ConfigChoice
              name={`${id}-sound-${key}`}
              label={`Sound for cue ${i + 1}`}
              hideLegend
              options={SOUNDS}
              value={cue.sound}
              onChoose={(sound) => edit(i, { sound })}
            />
          </div>
        );
      })}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {rows.length < CUES.most && <GlassButton kind="secondary" size="s" onClick={add}>Add a cue</GlassButton>}
        <ConfigHint live>
          {places(all.length)} in all (at most {PLACES.most}){full ? '. All five cues are filled. Clear one to pick another phrase.' : ''}
        </ConfigHint>
      </div>
    </fieldset>
  );
}
