/**
 * The poll's editor, under a post's own (docs/plans/2026-11-20-polls-design.md, sections 4 and 6; plan Task 6): "Add a poll" opens a fieldset with the question, the options (two to start,
 * "Add option" up to `pollOptionsMax`, a Remove on each past two), how many a voter may pick, whether ballots are secret, and how long it stays open. "Remove poll" closes it again. It is
 * controlled: the reply box, the new-thread form and the edit form each hold the draft (`PollDraft`) and send it with the post.
 *
 * `problem` is the first predicate `pollDraftProblems` found, in the database's own words; the editor says it under the field it names (`fieldOf`), as an alert, and the parent clears it when the draft changes.
 */
import { useId, type KeyboardEvent } from 'react';
import { lastsHours, pollDraftProblems, spanWords, type PollDraft, type PollSettings } from '../../rules/polls.ts';
import type { Span } from '../../rules/types.ts';
import type { Poll } from '../data/api.ts';
import './poll-draft.css';

/** What "Closes in" offers, before the settings' bounds are applied. */
const CHOICES: readonly Span[] = [
  { unit: 'hour', count: 1 }, { unit: 'day', count: 1 }, { unit: 'day', count: 3 }, { unit: 'week', count: 1 }, { unit: 'week', count: 2 },
];

/** The choices the settings allow. */
export function lastsChoices(settings: PollSettings): Span[] {
  const lo = lastsHours(settings.pollLastsMin) ?? 0;
  const hi = lastsHours(settings.pollLastsMax) ?? Infinity;
  return CHOICES.filter((c) => { const h = lastsHours(c)!; return h >= lo && h <= hi; });
}

const spanOf = (settings: PollSettings, wanted: Span): Span => {
  const choices = lastsChoices(settings);
  const want = lastsHours(wanted) ?? 24;
  return choices.reduce<Span | undefined>((best, c) => (best === undefined || Math.abs(lastsHours(c)! - want) < Math.abs(lastsHours(best)! - want) ? c : best), undefined) ?? settings.pollLastsMin;
};

/** A new poll: two empty options, one pick, public, a day (or the nearest the settings allow). */
export const emptyPoll = (settings: PollSettings): PollDraft => ({ question: '', options: ['', ''], pick: 1, secret: false, lasts: spanOf(settings, { unit: 'day', count: 1 }) });

/** A poll on a post, as its author's editor starts from it: its length is the nearest choice to the one it was written with. */
export function draftOfPoll(poll: Poll, settings: PollSettings): PollDraft {
  const p = poll.act.payload;
  const options = Array.isArray(p.options) ? (p.options as readonly string[]) : ['', ''];
  const length = (Date.parse(poll.endsAt) - Date.parse(poll.act.createdAt ?? poll.endsAt)) / 3_600_000;
  return {
    question: typeof p.question === 'string' ? p.question : '',
    options,
    pick: typeof p.pick === 'number' ? p.pick : 1,
    secret: p.secret === true,
    lasts: spanOf(settings, { unit: 'hour', count: Number.isFinite(length) && length > 0 ? length : 24 }),
  };
}

export const samePoll = (a: PollDraft | null, b: PollDraft | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The field a refusal in `pollDraftProblems`' words is about. */
export type PollField = 'question' | 'options' | 'pick' | 'lasts';
export function fieldOf(problem: string): PollField {
  if (problem.startsWith('question')) return 'question';
  if (problem.startsWith('a poll lets')) return 'pick';
  if (problem.startsWith('a poll lasts')) return 'lasts';
  return 'options';
}

/** The first problem a draft has, or null. */
export const problemOf = (draft: PollDraft, settings: PollSettings): string | null => pollDraftProblems(draft, settings)[0] ?? null;

export interface PollDraftProps {
  /** The poll being written; null while there is none (the button offers "Add a poll"). */
  readonly value: PollDraft | null;
  readonly onChange: (next: PollDraft | null) => void;
  readonly settings: PollSettings;
  /** What `problemOf` said at the last Send, shown under its field. */
  readonly problem?: string | null;
  /** A poll that cannot be added here. */
  readonly disabled?: boolean;
}

/** Enter in a text field of the poll is the field's own, never a Send of the post it is under. */
const noEnter = (e: KeyboardEvent<HTMLFieldSetElement>) => {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'text') e.preventDefault();
};

export function PollEditor({ value, onChange, settings, problem = null, disabled = false }: PollDraftProps) {
  const id = useId();
  if (value === null) {
    return <p className="kb-poll-add"><button type="button" className="kb-button" disabled={disabled} onClick={() => onChange(emptyPoll(settings))}>Add a poll</button></p>;
  }
  const field = problem === null ? null : fieldOf(problem);
  const say = (f: PollField) => (field === f ? <p role="alert" className="kb-notice" data-kb-tone="refusal" id={`${id}-${f}-problem`}>{problem}</p> : null);
  const desc = (f: PollField) => (field === f ? { 'aria-describedby': `${id}-${f}-problem`, 'aria-invalid': true as const } : {});
  const set = (patch: Partial<PollDraft>) => onChange({ ...value, ...patch });
  const options = value.options;
  const setOption = (i: number, text: string) => set({ options: options.map((o, k) => (k === i ? text : o)) });
  const remove = (i: number) => { const next = options.filter((_, k) => k !== i); set({ options: next, pick: Math.min(value.pick, next.length) }); };
  const choices = lastsChoices(settings);
  const here = typeof value.lasts === 'string' ? undefined : value.lasts;
  const choice = here === undefined ? '' : spanWords(here);
  const listed = choices.some((c) => spanWords(c) === choice);

  return (
    <fieldset className="kb-poll-draft" onKeyDown={noEnter}>
      <legend>Poll</legend>
      <div className="kb-field">
        <label htmlFor={`${id}-question`}>Question</label>
        <input id={`${id}-question`} className="kb-input kb-poll-draft-question" value={value.question} autoComplete="off" onChange={(e) => set({ question: e.target.value })} {...desc('question')} />
        {say('question')}
      </div>
      <div className="kb-field" role="group" aria-labelledby={`${id}-options`}>
        <span id={`${id}-options`}>Options</span>
        <ol className="kb-poll-draft-options">
          {options.map((o, i) => (
            <li key={i}>
              <input className="kb-input" aria-label={`Option ${i + 1}`} value={o} autoComplete="off" onChange={(e) => setOption(i, e.target.value)} {...desc('options')} />
              {options.length > 2 && <button type="button" className="kb-button" data-kb-size="small" aria-label={`Remove option ${i + 1}`} onClick={() => remove(i)}>Remove</button>}
            </li>
          ))}
        </ol>
        {options.length < settings.pollOptionsMax && <button type="button" className="kb-button" data-kb-size="small" onClick={() => set({ options: [...options, ''] })}>Add option</button>}
        {say('options')}
      </div>
      <div className="kb-field">
        <label htmlFor={`${id}-pick`}>Voters may pick</label>{' '}
        <select id={`${id}-pick`} className="kb-select" value={value.pick} onChange={(e) => set({ pick: Number(e.target.value) })} {...desc('pick')}>
          {options.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
        {say('pick')}
      </div>
      <label className="kb-poll-draft-check">
        <input type="checkbox" checked={value.secret} onChange={(e) => set({ secret: e.target.checked })} /> Secret ballots: only the counts are shown
      </label>
      <div className="kb-field">
        <label htmlFor={`${id}-lasts`}>Closes in</label>{' '}
        <select id={`${id}-lasts`} className="kb-select" value={choice} onChange={(e) => set({ lasts: choices.find((c) => spanWords(c) === e.target.value)! })} {...desc('lasts')}>
          {!listed && <option value={choice}>{choice || 'Choose'}</option>}
          {choices.map((c) => <option key={spanWords(c)} value={spanWords(c)}>{spanWords(c)}</option>)}
        </select>
        {say('lasts')}
      </div>
      <p><button type="button" className="kb-button" onClick={() => onChange(null)}>Remove poll</button></p>
    </fieldset>
  );
}
