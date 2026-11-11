/**
 * You Were Saying?'s length in the play form (docs/plans/2026-11-07-you-were-saying-design.md, section 2): a stepped slider, a native range
 * input, from the base length to the most the economy allows. Each step is named in words with its price beside it; the price is the card's
 * own `playPrice` over the settings as the server will charge them, so the form and the charge agree. The base step costs nothing more:
 * the card's price was paid at the machine. Untouched, the form holds the base length and says so to the play form, which cannot play a
 * card with no length.
 */
import { useEffect } from 'react';
import { orbs, withCardEconomy } from '../../../../engine/ui/cards/faces.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfaIfAny } from '../../../../engine/ui/context.tsx';
import { defaults } from '../../settings.ts';
import { mostSteps, youWereSaying } from '../you-were-saying.ts';
import './you-were-saying.css';

/** Each step's length in words, from the base (25 tokens) up: honest about how much it writes. */
export const STEP_WORDS: readonly string[] = [
  'about a sentence',
  'a couple of sentences',
  'a short paragraph',
  'a paragraph',
  'a paragraph and a half',
  'a long paragraph',
  'a very long paragraph',
  'a rant',
];

const wordsOf = (step: number) => STEP_WORDS[Math.min(step, STEP_WORDS.length - 1)];

export function ConfigForm({ config, onChange, post, id }: ConfigFormProps) {
  const kayfa = useKayfaIfAny();
  const settings = kayfa ? withCardEconomy(kayfa.instance.settings, kayfa.settings.cardEconomy) : defaults;
  const most = mostSteps(settings);
  const untouched = typeof config?.steps !== 'number';
  const steps = untouched ? 0 : Math.max(0, Math.min(config.steps as number, most));
  useEffect(() => {
    if (untouched) onChange({ steps: 0 });
  }, [untouched, onChange]);
  const body = typeof post.currentPayload?.body === 'string' ? post.currentPayload.body : '';
  const price = youWereSaying.playPrice(settings, { reach: 'post', act: post.id, kind: 'post', length: body.length, text: body }, { steps });
  const priceWords = price === 0 ? 'free to play' : orbs(price);
  return (
    <fieldset className="dw-ywsf-form">
      <legend className="dw-ywsf-legend">How much it writes</legend>
      <label htmlFor={`${id}-steps`} className="dw-ywsf-label">How much it writes</label>
      <input
        id={`${id}-steps`} type="range" min={0} max={most} step={1} value={steps}
        aria-valuetext={`${wordsOf(steps)}, ${priceWords}`} aria-describedby={`${id}-length`}
        onChange={(e) => onChange({ steps: Number(e.target.value) })}
      />
      <p id={`${id}-length`} role="status" className="dw-ywsf-length">
        <span className="dw-ywsf-words">{wordsOf(steps)}</span>
        <span className="dw-ywsf-price kb-num">{price === 0 ? 'Free' : orbs(price)}</span>
      </p>
      <p className="dw-ywsf-fine">
        {price === 0 ? 'Nothing more to play it: its price was paid at the machine.' : `${orbs(price)} on top of the price you paid at the machine.`}
      </p>
    </fieldset>
  );
}
