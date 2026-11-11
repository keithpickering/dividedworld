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

/** The length in words by the tokens a step reaches, the largest threshold the tokens meet: honest under overridden step sizes. */
const WORDS_BY_TOKENS: readonly (readonly [number, string])[] = [
  [200, 'a rant'],
  [175, 'a very long paragraph'],
  [150, 'a long paragraph'],
  [125, 'a paragraph and a half'],
  [100, 'a paragraph'],
  [75, 'a short paragraph'],
  [50, 'a couple of sentences'],
  [0, 'about a sentence'],
];

const wordsOf = (tokens: number) => WORDS_BY_TOKENS.find(([least]) => tokens >= least)?.[1] ?? 'about a sentence';
const orbWord = (hundredths: number) => (hundredths === 100 ? 'orb' : 'orbs');

export function ConfigForm({ config, onChange, post, id }: ConfigFormProps) {
  const kayfa = useKayfaIfAny();
  const settings = kayfa ? withCardEconomy(kayfa.instance.settings, kayfa.settings.cardEconomy) : defaults;
  // validateConfig holds no settings and bounds steps by the instance's defaults (a known engine gap), so a live override that raises the
  // most must not make the form offer a step the server refuses; a live override that lowers it still wins.
  const most = Math.min(mostSteps(settings), mostSteps(defaults));
  const untouched = typeof config?.steps !== 'number';
  const steps = untouched ? 0 : Math.max(0, Math.min(config.steps as number, most));
  useEffect(() => {
    if (untouched) onChange({ steps: 0 });
  }, [untouched, onChange]);
  const body = typeof post.currentPayload?.body === 'string' ? post.currentPayload.body : '';
  const price = youWereSaying.playPrice(settings, { reach: 'post', act: post.id, kind: 'post', length: body.length, text: body }, { steps });
  const words = wordsOf(youWereSaying.writes!.tokens({ steps }, settings));
  const priceWords = price === 0 ? 'free to play' : `${orbs(price)} ${orbWord(price)} more`;
  return (
    <div className="dw-ywsf-form">
      <label htmlFor={`${id}-steps`} className="dw-ywsf-label">How much it writes</label>
      <input
        id={`${id}-steps`} type="range" min={0} max={most} step={1} value={steps}
        aria-valuetext={`${words}, ${priceWords}`}
        onChange={(e) => onChange({ steps: Number(e.target.value) })}
      />
      <p className="dw-ywsf-length" aria-hidden="true">
        <span className="dw-ywsf-words">{words}</span>
        <span className="dw-ywsf-price kb-num">{price === 0 ? 'Free' : orbs(price)}</span>
      </p>
      <p className="dw-ywsf-fine">
        {price === 0 ? 'Nothing more to play it: its price was paid at the machine.' : `${orbs(price)} on top of the price you paid at the machine.`}
      </p>
    </div>
  );
}
