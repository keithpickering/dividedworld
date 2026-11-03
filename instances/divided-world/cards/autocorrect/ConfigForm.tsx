/**
 * Autocorrect's settings in the play form (docs/plans/2026-11-03-autocorrect-design.md, section 1): the phrase to cover and the
 * words to cover it with, as two labeled fields bounded as the card's rules bound them (autocorrect.ts), and a live line under them
 * that counts the places the phrase covers in this post's own words, through the card's own matcher, so the form and the server
 * agree. The count is a preview; the server decides again, and refuses a phrase that is not there in the same words.
 */
import { useMemo } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { PHRASE, REPLACEMENT } from '../autocorrect.ts';
import { occurrences } from './match.ts';
import './autocorrect.css';

export function ConfigForm({ config, onChange, post, id }: ConfigFormProps) {
  const phrase = typeof config?.phrase === 'string' ? config.phrase : '';
  const replacement = typeof config?.replacement === 'string' ? config.replacement : '';
  const body = typeof post.currentPayload?.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  const places = useMemo(() => (phrase.trim() ? occurrences(text, phrase.trim()).length : 0), [text, phrase]);
  return (
    <fieldset className="dw-ac-form">
      <legend className="dw-ac-form-legend">What to autocorrect</legend>
      <label htmlFor={`${id}-phrase`} className="dw-ac-form-label">Phrase to cover</label>
      <input
        id={`${id}-phrase`} type="text" value={phrase} maxLength={PHRASE.most} autoComplete="off" spellCheck={false}
        aria-describedby={`${id}-places`} onChange={(e) => onChange({ phrase: e.target.value, replacement })}
      />
      <label htmlFor={`${id}-replacement`} className="dw-ac-form-label">Cover it with</label>
      <input
        id={`${id}-replacement`} type="text" value={replacement} maxLength={REPLACEMENT.most} autoComplete="off"
        onChange={(e) => onChange({ phrase, replacement: e.target.value })}
      />
      <p id={`${id}-places`} role="status" className="dw-ac-form-places">
        {!phrase.trim() ? `At least ${PHRASE.least} letters or digits, matched as whole words in any case.`
          : places ? `Covers ${places} ${places === 1 ? 'place' : 'places'} in this post` : 'Not in this post\'s own words'}
      </p>
    </fieldset>
  );
}
