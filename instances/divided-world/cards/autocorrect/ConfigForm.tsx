/**
 * Autocorrect's settings in the play form (docs/plans/2026-11-03-autocorrect-design.md, section 1): the phrase to cover and the
 * words to cover it with, as two ConfigFields bounded as the card's rules bound them (autocorrect.ts), and a live ConfigHint under them
 * that counts the places the phrase covers in this post's own words, through the card's own matcher, so the form and the server
 * agree. The count is a preview; the server decides again, and refuses a phrase that is not there in the same words.
 */
import { useMemo } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { ConfigField } from '../../../../engine/ui/cards/config/ConfigField.tsx';
import { ConfigHint } from '../../../../engine/ui/cards/config/ConfigHint.tsx';
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
    <div role="group" aria-label="What to autocorrect">
      <ConfigField
        id={`${id}-phrase`} label="Phrase to cover" value={phrase} maxLength={PHRASE.most}
        onChange={(value) => onChange({ phrase: value, replacement })}
      />
      <ConfigField
        id={`${id}-replacement`} label="Cover it with" value={replacement} maxLength={REPLACEMENT.most}
        onChange={(value) => onChange({ phrase, replacement: value })}
      />
      <ConfigHint live>
        {!phrase.trim() ? `At least ${PHRASE.least} letters or digits, matched as whole words in any case.`
          : places ? `Covers ${places} ${places === 1 ? 'place' : 'places'} in this post` : 'Not in this post\'s own words'}
      </ConfigHint>
    </div>
  );
}
