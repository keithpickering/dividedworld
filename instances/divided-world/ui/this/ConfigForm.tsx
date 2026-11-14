/**
 * THIS's settings in the play form (docs/plans/2026-11-13-this-plan.md, Task 6; design section 1): the phrase to point at and the words to say after THIS,
 * in the glass's own pieces (engine/ui/cards/config). The post's words are shown to select from, a selection filling the phrase as whole words
 * (../whole-words.ts, shared with Laugh Track). The phrase is bounded as the card's rules bound it, in the rules' own words, asked of the rules'
 * `validateConfig` so the two cannot drift; the hint under it counts the phrase's places in this post's own words through the card's own matcher,
 * so the form and the server agree. The count is a preview; the server decides again.
 *
 * The words carry a count of characters as the rules count them, drawn beside the field and spoken politely and seldom, as the play form's message
 * count is: only as the words near the limit, fill it, or fall back out of it. A line shows the note as it will read, in plain type: the glass's
 * own words, not the note's drawing. The form reports the trimmed pair on every change.
 */
import { useMemo, useRef, useState } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import { ConfigField } from '../../../../engine/ui/cards/config/ConfigField.tsx';
import { ConfigHint } from '../../../../engine/ui/cards/config/ConfigHint.tsx';
import { PostWords } from '../../../../engine/ui/cards/config/PostWords.tsx';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { occurrences } from '../../cards/autocorrect/match.ts';
import { PHRASE, characters } from '../../cards/phrase-bound.ts';
import { WORDS, thisCard } from '../../cards/this.ts';
import { wholeWords } from '../whole-words.ts';

/** Where the words' count starts to speak: its last stretch before the limit. */
const NEAR = WORDS.most - 20;

/** Why a phrase is out of the card's bounds, in the rules' own words, asked of the rules' `validateConfig`; undefined within them. */
function boundOf(phrase: string): string | undefined {
  const verdict = thisCard.validateConfig({ phrase, words: '' });
  return verdict.ok ? undefined : `${verdict.why.charAt(0).toUpperCase()}${verdict.why.slice(1)}`;
}

export function ConfigForm({ config, onChange, post, id }: ConfigFormProps) {
  const [phrase, setPhrase] = useState(() => (typeof config?.phrase === 'string' ? config.phrase : ''));
  const [words, setWords] = useState(() => (typeof config?.words === 'string' ? config.words : ''));
  /* What the count last said aloud, and how many times, so the same words said again are a change a screen reader hears. */
  const [said, setSaid] = useState({ words: '', n: 0 });
  const form = useRef<HTMLFieldSetElement>(null);
  const body = typeof post.currentPayload?.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  const trimmed = phrase.trim();
  const places = useMemo(() => (trimmed ? occurrences(text, trimmed).length : 0), [text, trimmed]);
  const bound = trimmed ? boundOf(trimmed) : undefined;
  const lineId = `${id}-phrase-line`;
  const line = !trimmed ? `At least ${PHRASE.least} letters or digits, matched as whole words in any case.`
    : bound ? undefined
      : places === 0 ? 'These words are not in this post\'s own words.'
        : places === 1 ? 'THIS will point at these words.'
          : `These words are in the post ${places} times. THIS points at the first. Select more words to point at another.`;

  const report = (nextPhrase: string, nextWords: string) => onChange({ phrase: nextPhrase.trim(), words: nextWords.trim() });
  const changePhrase = (next: string) => { setPhrase(next); report(next, words); };
  const sayCount = (spoken: string) => setSaid((was) => ({ words: spoken, n: spoken === '' ? was.n : was.n + 1 }));
  const changeWords = (next: string) => {
    const was = characters(words);
    const now = characters(next);
    /* Said politely and seldom: never on every key, only as the words near their limit, or fill it (the field stops typing at the limit, and the form is only ever given words within it, so nothing runs past). */
    if (now === WORDS.most && was < WORDS.most) sayCount(`${WORDS.most} of ${WORDS.most} characters: the words are full.`);
    else if (now >= NEAR && was < NEAR) sayCount(`${WORDS.most - now} characters left.`);
    else if (now < NEAR || (now < WORDS.most && was === WORDS.most)) sayCount('');
    setWords(next);
    report(phrase, next);
  };
  const fill = (selected: string) => {
    const whole = wholeWords(selected, text);
    if (whole) changePhrase(whole);
  };

  return (
    <fieldset ref={form} className="kb-play-config-group">
      <legend className="kb-play-label">Point at it</legend>
      <div>
        <ConfigHint>Select words in the post below with a pointer or by touch, or type them.</ConfigHint>
        <PostWords words={text} within={form} onSelect={fill} />
      </div>
      <ConfigField
        id={`${id}-phrase`} label="Phrase to point at" value={phrase} maxLength={PHRASE.most}
        onChange={changePhrase} describedBy={line ? lineId : undefined} why={bound}
      />
      {line && <ConfigHint id={lineId} live>{line}</ConfigHint>}
      <ConfigField
        id={`${id}-words`} label="After THIS (optional)" value={words} maxLength={WORDS.most}
        onChange={changeWords} describedBy={`${id}-words-count`}
      />
      <p className="kb-play-fine" id={`${id}-words-count`}>
        <span>{`${characters(words)} / ${WORDS.most}`}</span>
        <span className="kb-visually-hidden" aria-live="polite" data-kb-count-said>{said.words}{said.words && said.n % 2 === 0 ? '\u00a0' : ''}</span>
      </p>
      <ConfigHint>The note will read: <span data-this-note>{words.trim() ? `THIS ${words.trim()}` : 'THIS'}</span></ConfigHint>
    </fieldset>
  );
}
