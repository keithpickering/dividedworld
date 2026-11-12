/**
 * The set form's "Only when" group (docs/plans/2026-11-08-quote-conditions-design.md, sections 1 to 4 and 7): the conditions a Move may be set
 * with, each optional, so that it springs only on a quote that meets all of them. It is a disclosure, closed by default, so the catch-all stays the
 * one-tap default; a closed row still says how many conditions are set, and the form's summary line reads them back in plain words, so a condition
 * is never hidden by accident.
 *
 * Three fields. "They say…" is a phrase in the quoting post's own words, locked and filled with the card's own phrase for a card that has one.
 * "They quote…" is a passage of the post being set, typed or selected in a read-only view of the post's visible words (the same words the rules
 * match it against; `PostWords`, the card settings' own piece) in the form itself, with no modal. "Who" is Anyone, Only these or Anyone but these; the two lists are chosen with the board
 * search's character box (`GlassCombobox` over `charactersSource`, which suggests debuted characters by id and name and nothing about who owns
 * one), each choice a removable chip, at most five.
 *
 * The rules are the engine's (`decideSet`, `SetConditions`): this file holds the draft, the plain words and the placing of a refusal beside its field.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SET_PHRASE_MOST, SET_WHO_MOST, type SetConditions as Conditions } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { GlassButton } from '../glass/Button.tsx';
import { GlassCombobox } from '../glass/GlassCombobox.tsx';
import { charactersSource } from '../search/suggest.ts';
import { PostWords } from './config/PostWords.tsx';
import { shortQuote, whoWords } from './lens-words.ts';

export type WhoMode = 'anyone' | 'only' | 'except';
export interface Chosen { readonly id: Id; readonly name: string }

/** What the player has typed and chosen, kept by the form so a closed group does not lose it. */
export interface ConditionsDraft {
  readonly says: string;
  readonly passage: string;
  readonly mode: WhoMode;
  readonly who: readonly Chosen[];
}
export const noConditions: ConditionsDraft = { says: '', passage: '', mode: 'anyone', who: [] };

export type Field = 'says' | 'passage' | 'who';
export type Problems = Readonly<Partial<Record<Field, string>>>;

const trimmed = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/**
 * The conditions to send, or undefined when none is set (the request then carries no `when`). A locked Says is the card's own phrase, which the rules
 * hold, so it is never sent. A list with nobody in it is sent as it is, for the rules to refuse beside the field.
 */
export function whenOf(draft: ConditionsDraft, lockedSays: boolean): Conditions | undefined {
  const says = lockedSays ? '' : trimmed(draft.says);
  const passage = trimmed(draft.passage);
  const out: { says?: string; passage?: string; who?: { except: boolean; characters: readonly string[] } } = {};
  if (says !== '') out.says = says;
  if (passage !== '') out.passage = passage;
  if (draft.mode !== 'anyone') out.who = { except: draft.mode === 'except', characters: draft.who.map((c) => c.id) };
  return Object.keys(out).length === 0 ? undefined : out;
}

/** How many conditions are set, for the closed row. */
export const countOf = (when: Conditions | undefined): number => (when ? Number(when.says !== undefined) + Number(when.passage !== undefined) + Number(when.who !== undefined) : 0);

/**
 * The conditions in plain words, after "Springs": "when Spritey or Boshi quotes “the punchline” saying “nice try”", "when anyone but Boshi quotes this
 * post". The same shape the setter's log uses (lines.ts, `setWaits`), its pieces shared (`shortQuote`, `whoWords`).
 */
export function conditionWords(when: Conditions, nameOf: (id: Id) => string): string {
  const who = when.who ? whoWords(when.who.characters, when.who.except, nameOf) : null;
  return `when ${who ?? 'someone'} quotes ${when.passage ? shortQuote(when.passage) : 'this post'}${when.says ? ` saying ${shortQuote(when.says)}` : ''}`;
}

/**
 * Which field a refusal belongs to, from its words: the rules' (`decideSet`) and the database's (set_card, 0144). Null for any other, which the form
 * says in its alert. The rules refuse in one voice with no field, so this reads their messages' beginnings, and a test asks `decideSet` itself for each.
 */
export function fieldOfRefusal(why: string): Field | null {
  if (/ already waits for its own phrase$/u.test(why) || why.startsWith('what they say')) return 'says';
  if (why.startsWith('the passage') || why.startsWith('that passage')) return 'passage';
  if (why.startsWith('name at least one') || why.startsWith('name at most') || why.startsWith('name each') || why.startsWith('a list names') || / is not a character on the board$/u.test(why)) return 'who';
  return null;
}

/** The text of a selection as a passage: its first line only (a phrase is one line), spaces folded, at most the rules' bound. */
export function passageOf(selected: string): { readonly text: string; readonly cut: 'line' | 'length' | null } {
  const lines = selected.split(/\r?\n/u).map(trimmed).filter((l) => l !== '');
  const first = lines[0] ?? '';
  const chars = [...first];
  if (chars.length > SET_PHRASE_MOST) return { text: chars.slice(0, SET_PHRASE_MOST).join('').trimEnd(), cut: 'length' };
  return { text: first, cut: lines.length > 1 ? 'line' : null };
}

export interface SetConditionsProps {
  readonly id: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly draft: ConditionsDraft;
  readonly onChange: (draft: ConditionsDraft) => void;
  /** The card's own phrase when it has one (its Says is then locked to it); null for a card without. */
  readonly lockedSays: string | null;
  /** The post's visible words, which a passage is picked from. */
  readonly words: string;
  /** How many conditions are set, said on the closed row. */
  readonly count: number;
  readonly problems: Problems;
}

/** Where focus goes after a change: a chip's remove button, or the character box. */
type Next = { readonly chip: Id } | 'box' | null;

export function SetConditions({ id, open, onToggle, draft, onChange, lockedSays, words, count, problems }: SetConditionsProps) {
  const { api } = useKayfa();
  const source = useMemo(() => charactersSource(api), [api]);
  const panel = `${id}-when`;
  const [said, setSaid] = useState('');
  const [spill, setSpill] = useState(false);
  const [picked, setPicked] = useState<'line' | 'length' | null>(null);
  /* A new box after each choice: a chosen suggestion's label fills the box, and the next one starts empty. */
  const [boxKey, setBoxKey] = useState(0);
  const next = useRef<Next>(null);
  const root = useRef<HTMLFieldSetElement>(null);
  const latest = useRef({ draft, onChange });
  latest.current = { draft, onChange };

  /* A selection inside the post's words fills "They quote…": its first line, at most the rules' bound. */
  const pick = (selected: string) => {
    setSpill(false);
    const { text, cut } = passageOf(selected);
    if (text === '') return;
    setPicked(cut);
    if (text !== latest.current.draft.passage) latest.current.onChange({ ...latest.current.draft, passage: text });
  };

  /* Focus moves on after a chip is added or removed, once the new list is drawn. */
  useEffect(() => {
    const go = next.current;
    if (go === null) return;
    next.current = null;
    const el = go === 'box' ? root.current?.querySelector<HTMLElement>('input[role="combobox"]:not(:disabled)') : root.current?.querySelector<HTMLElement>(`[data-kb-remove="${go.chip}"]`);
    el?.focus();
  });

  const full = draft.who.length >= SET_WHO_MOST;
  const set = (patch: Partial<ConditionsDraft>) => onChange({ ...draft, ...patch });
  const choose = (option: { readonly id: string; readonly label: string }) => {
    if (draft.who.some((c) => c.id === option.id)) { setSaid(`${option.label} is already chosen.`); next.current = 'box'; setBoxKey((k) => k + 1); return; }
    if (full) return;
    const who = [...draft.who, { id: option.id, name: option.label }];
    setSaid(`Added ${option.label}. ${who.length} of ${SET_WHO_MOST}.`);
    next.current = who.length >= SET_WHO_MOST ? { chip: option.id } : 'box';
    setBoxKey((k) => k + 1);
    set({ who });
  };
  const remove = (at: number) => {
    const gone = draft.who[at]!;
    const who = draft.who.filter((_, i) => i !== at);
    const neighbor = who[at] ?? who[at - 1];
    setSaid(`Removed ${gone.name}. ${who.length} of ${SET_WHO_MOST}.`);
    next.current = neighbor ? { chip: neighbor.id } : 'box';
    set({ who });
  };
  /* Enter in the box is its own (it chooses a suggestion); never the form's, which would set the card. */
  const keep = (e: KeyboardEvent<HTMLFieldSetElement>) => { if (e.key === 'Enter' && !e.defaultPrevented && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); };
  /* Enter in these two is never the form's: setting spends orbs, so Set is pressed deliberately. */
  const noEnter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.preventDefault(); };
  const saying = lockedSays !== null;
  const why = (field: Field) => `${id}-why-${field}`;
  const mark = (field: Field) => (problems[field] ? { 'aria-invalid': true as const } : {});

  return (
    <div className="kb-play-when" data-kb-open={open ? 'true' : undefined}>
      <GlassButton className="kb-play-when-toggle" size="s" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={onToggle}>
        Only when… (optional)
        {count > 0 && <span className="kb-play-when-count"> · {count} set</span>}
        <span aria-hidden="true" className="kb-play-when-mark">{open ? ' −' : ' +'}</span>
      </GlassButton>
      {open && (
        <fieldset id={panel} className="kb-play-when-group" ref={root}>
          <legend className="kb-visually-hidden">Only when</legend>
          <p className="kb-play-fine">Springs only on a quote that meets every condition you set. Leave them all off and it springs on any quote.</p>

          <div className="kb-play-when-field">
            <label htmlFor={`${id}-says`} className="kb-play-label">They say…</label>
            <input
              id={`${id}-says`}
              type="text"
              className="kb-play-input"
              autoComplete="off"
              readOnly={saying}
              onKeyDown={noEnter}
              value={saying ? lockedSays : draft.says}
              onChange={(e) => set({ says: [...e.target.value].slice(0, SET_PHRASE_MOST).join('') })}
              aria-describedby={`${saying ? `${id}-says-locked ` : ''}${why('says')}`}
              {...mark('says')}
            />
            {saying && <p id={`${id}-says-locked`} className="kb-play-fine">This card always waits for its own phrase.</p>}
            {!saying && <p className="kb-play-fine">Words in the quoting post. Case, spaces and punctuation between words are not matched exactly. At most {SET_PHRASE_MOST} characters.</p>}
            <p id={why('says')} className="kb-play-why" role="status">{problems.says ?? ''}</p>
          </div>

          <div className="kb-play-when-field">
            <label htmlFor={`${id}-passage`} className="kb-play-label">They quote…</label>
            <input
              id={`${id}-passage`}
              type="text"
              className="kb-play-input"
              autoComplete="off"
              onKeyDown={noEnter}
              value={draft.passage}
              onChange={(e) => { setPicked(null); setSpill(false); set({ passage: [...e.target.value].slice(0, SET_PHRASE_MOST).join('') }); }}
              aria-describedby={`${id}-passage-hint ${why('passage')}`}
              {...mark('passage')}
            />
            <p id={`${id}-passage-hint`} className="kb-play-fine">
              Select words below with a pointer or by touch, or type them. At most {SET_PHRASE_MOST} characters.{spill ? ' Your selection went past the post\'s words, so nothing was taken. Select inside them.' : ''}{picked === 'line' ? ' A passage is one line, so only the first line of your selection was kept.' : picked === 'length' ? ` A passage is at most ${SET_PHRASE_MOST} characters, so the rest of your selection was left out.` : ''}
            </p>
            <p id={why('passage')} className="kb-play-why" role="status">{problems.passage ?? ''}</p>
            {/* Read-only, and in the tab order so its scroll can be reached; a selection in it (by pointer or touch; typing is always possible) fills the field above. One that runs past its edges is said so and taken from nowhere. */}
            <PostWords words={words} within={root} onSpill={setSpill} onSelect={pick} />
          </div>

          <fieldset className="kb-play-choice kb-play-when-field">
            <legend className="kb-play-label">Who</legend>
            <div className="kb-play-choice-row kb-play-who-row">
              {([['anyone', 'Anyone'], ['only', 'Only these'], ['except', 'Anyone but these']] as const).map(([value, label]) => (
                <label key={value} className="kb-play-choice-opt">
                  <input type="radio" name={`${id}-who`} className="kb-visually-hidden" checked={draft.mode === value} onChange={() => set({ mode: value })} />
                  <span className="kb-play-choice-face"><span className="kb-glass-upright">{label}</span></span>
                </label>
              ))}
            </div>
            {draft.mode !== 'anyone' && (
              <div className="kb-play-who">
                {draft.who.length > 0 && (
                  <ul className="kb-play-chips" aria-label="Chosen characters">
                    {draft.who.map((c, at) => (
                      <li key={c.id} className="kb-play-chip kb-glass-cut-panel">
                        <span className="kb-play-chip-name">{c.name}</span>
                        <button type="button" className="kb-play-chip-remove" data-kb-remove={c.id} aria-label={`Remove ${c.name}`} onClick={() => remove(at)}><span aria-hidden="true">×</span></button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="kb-play-fine kb-play-who-count">{draft.who.length} of {SET_WHO_MOST}{full ? '. Five is the most. Remove one to add another.' : ''}</p>
                {/* A fieldset that is disabled disables the box inside it. */}
                <fieldset className="kb-play-who-box" disabled={full} onKeyDown={keep}>
                  <GlassCombobox key={boxKey} label="Character" placeholder="Start a name" minChars={2} source={source} onChoose={choose} />
                </fieldset>
                <p role="status" aria-label="Who was chosen" className="kb-play-fine kb-play-who-said">{said}</p>
              </div>
            )}
            <p id={why('who')} className="kb-play-why" role="status">{problems.who ?? ''}</p>
          </fieldset>
        </fieldset>
      )}
    </div>
  );
}
