/**
 * What the Strategy Guide's markers draw (markdown.ts's MARKERS), each from the live instance so the guide is true after every retune:
 *
 * - `letter`: the instance's welcome letter (`InstanceUi.onboarding.letter`), so it is written once and the welcome page and the guide
 *   read the same words; its headings sit one level down, inside the guide's section.
 * - `reactions`: the instance's reaction grid, laid out as the picker lays it: excited above calm, negative left of positive, each
 *   corner by the instance's name for it with its reactions.
 * - `classes`: each of the instance's classes in its own colors, with the class card's own drawing of its marks (ClassCards.tsx's
 *   `Marks`, so the guide cannot draw a corner the card does not), the card's description from the class's entry, and the guide's one
 *   line of hint. The marks are named in words and the hint is labeled, so neither rests on color or shape alone.
 * - `cards`: each card the instance sells with its kind, how it is played, its price as the Vending Machine charges it now, its
 *   flavor line and what it does in a sentence.
 *
 * The classes are shown to everyone who reads the guide because they are the instance's list, not anyone's character: nothing here is
 * computed from a player's own class or characters (CLAUDE.md, "A response never proves a private fact").
 */
import { useId, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import { facesOf, priceOf, rarityName, withCardEconomy } from '../cards/faces.ts';
import { classVars } from '../characters/ClassChip.tsx';
import { Marks } from '../characters/ClassCards.tsx';
import { readable } from '../reactions/Reactions.tsx';
import type { Quadrant } from '../../rules/types.ts';
import '../characters/characters.css';
import { Blocks } from './render.tsx';
import { parse } from './markdown.ts';
import type { Fill } from './render.tsx';

const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

/** The grid's rows and columns, in the picker's order: excited above calm, negative left of positive. */
const ROWS: readonly { readonly name: string; readonly cells: readonly [Quadrant, Quadrant] }[] = [
  { name: 'Excited', cells: ['excitedNegative', 'excitedPositive'] },
  { name: 'Calm', cells: ['boredNegative', 'calmPositive'] },
];

export function ReactionGrid() {
  const { instance, ui } = useKayfa();
  return (
    <div className="kb-guide-table-wrap" tabIndex={0}>
      <table className="kb-guide-grid" aria-label="The reaction grid">
        <thead>
          <tr><td /><th scope="col">Negative</th><th scope="col">Positive</th></tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.name}>
              <th scope="row">{row.name}</th>
              {row.cells.map((q) => (
                <td key={q}>
                  <b className="kb-guide-grid-name">{ui.quadrantLabels[q]}</b>
                  <span className="kb-guide-grid-set">
                    {instance.reactions.filter((r) => r.quadrant === q).map((r) => <span key={r.key} role="img" aria-label={readable(r.key)}>{r.emoji}</span>)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Classes() {
  const { instance, ui } = useKayfa();
  const group = useId();
  const dev = instance.developer;
  const hintLabel = dev ? `${possessive(dev.name)} hint` : 'Hint';
  return (
    <div className="kb-guide-classes">
      <div className="kb-guide-legend">
        <p>Top row excited, bottom row calm; left negative, right positive.</p>
        <ul aria-label="The marks">
          <li><span className="kb-class-mark" data-kb-mark="earns" aria-hidden="true">+</span>earns</li>
          <li><span className="kb-class-mark" data-kb-mark="hurts" aria-hidden="true">−</span>hurts</li>
          <li><span className="kb-class-mark" data-kb-mark="calls" aria-hidden="true" />earns by calling where a post ends up</li>
        </ul>
      </div>
      {instance.classes.map((c) => {
        const look = ui.classLooks?.[c.key];
        const name = `${group}-${c.key}-name`;
        const hint = ui.guide.hints[c.key];
        return (
          <div key={c.key} className="kb-guide-class" role="group" aria-labelledby={name} data-kb-class={c.key} style={classVars(c.key) as CSSProperties}>
            {look?.marks ? <Marks marks={look.marks} id={`${group}-${c.key}-marks`} /> : <span />}
            <div className="kb-guide-class-words">
              <h3 id={name} className="kb-guide-class-name"><span className="kb-class-chip kb-glass-skew"><span className="kb-glass-upright">{c.name}</span></span></h3>
              {look?.description && <p>{look.description}</p>}
              {hint && <p className="kb-guide-hint"><span className="kb-guide-hint-label">{hintLabel}</span>{' '}<span>{hint}</span></p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CardList() {
  const { instance, ui, settings } = useKayfa();
  const faces = facesOf(instance.cards, ui.cards, withCardEconomy(instance.settings, settings.cardEconomy));
  if (faces.length === 0) return null;
  return (
    <div className="kb-guide-table-wrap" tabIndex={0}>
      <table className="kb-guide-table kb-guide-cards" aria-label="The cards">
        <thead>
          <tr><th scope="col">Card</th><th scope="col">Kind</th><th scope="col">Played</th><th scope="col">Price in orbs</th><th scope="col">What it does</th></tr>
        </thead>
        <tbody>
          {faces.map((f) => (
            <tr key={f.key}>
              <th scope="row">{f.name}</th>
              <td>{`${f.tag} ${rarityName(f.rarity)}`}</td>
              <td>{f.play.charAt(0).toUpperCase() + f.play.slice(1)}</td>
              <td className="kb-num">{priceOf(f)}</td>
              <td>
                {f.tagline !== '' && <i className="kb-guide-flavor">{f.tagline}</i>}
                {f.tagline !== '' && f.summary !== '' && ' '}
                {f.summary}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The welcome letter, a marker inside it being nothing (the letter does not draw the guide). */
export function Letter({ fill }: { readonly fill: Fill }) {
  const { ui } = useKayfa();
  return <Blocks blocks={parse(ui.onboarding.letter).filter((b) => b.t !== 'marker')} fill={fill} demote={1} />;
}
