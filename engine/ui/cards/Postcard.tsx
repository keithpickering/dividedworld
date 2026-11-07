/**
 * A postcard's face, drawn the one way wherever a card is shown (the glass plan, section 5: 150 by
 * 225 with a 9px corner, a 1.5px ring in the card's own color with its glow): in the Vending
 * Machine's slot, fanned through the HUD's seam, in the Phone board's sheet, and large on the hand's
 * sheet. The card's color and ink come from its art (`CardArt`, the instance's data) as two custom
 * properties and the stylesheet reads nothing else, so a card the instance never drew is the glass's
 * own neon.
 *
 * It draws the face and nothing that acts: the caller gives it a `button` (a slot, a card in the
 * hand) or an `article` (the sheet) and the name that element carries, and everything drawn here
 * is for the eye (aria-hidden), since the name and the rules are said once, in words, by the
 * element around it. A card in the machine's slot is the machine's printing (`data-kb-art`, outside
 * the rendered type measurement as the machine's other printing is). `armed` is the state a play waits in, and pulses unless motion is reduced.
 */
import type { CSSProperties, ElementType, HTMLAttributes, Ref } from 'react';
import { gemOf, playWord, priceOf, rarityName, type CardFace } from './faces.ts';
import type { PostcardSize } from './template.ts';
import './postcard.css';

/** Where the card is drawn: its size and which parts of the face it holds. */
export type { PostcardSize };

export interface PostcardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly face: CardFace;
  readonly size: PostcardSize;
  /** The element: a button where it acts, an article on a sheet. */
  readonly as?: ElementType;
  readonly armed?: boolean;
  readonly ref?: Ref<HTMLElement>;
  /** Passed to a button. */
  readonly type?: 'button';
  readonly 'aria-pressed'?: boolean;
  readonly 'aria-expanded'?: boolean;
  readonly disabled?: boolean;
}

/**
 * The name of a postcard that is a button: the words it shows, in the order the markup holds them (the
 * name, the tag, and on the fan the tagline), then the word that says what it is. The fan shows its
 * tagline, so its name holds it too.
 */
export function cardLabel(face: CardFace, size: PostcardSize): string {
  /* The play's word is drawn after the tag, and the gem's rarity is its title: both said in words, after what is drawn before them. */
  const said = `${face.name}, ${face.tag}, ${playWord(face.play)}`;
  const shown = size === 'fan' && face.tagline ? `${said}. ${face.tagline}` : said;
  return `${shown}, ${face.rarity} postcard`;
}

export function Postcard({ face, size, as: As = 'span', armed = false, className, style, ...rest }: PostcardProps) {
  const vars = { '--kb-card-color': face.art.color, '--kb-card-ink': face.art.ink, ...(size !== 'sheet' ? { '--kb-name-chars': face.name.length } : {}), ...style } as CSSProperties;
  return (
    <As
      {...rest}
      className={`kb-postcard${className ? ` ${className}` : ''}`}
      style={vars}
      data-size={size}
      data-kb-card={face.key}
      data-kb-alignment={face.alignment}
      data-armed={armed ? '' : undefined}
      data-kb-art={size === 'slot' ? '' : undefined}
    >
      <span className="kb-postcard-glow" aria-hidden="true" />
      {face.art.canvas ? <img className="kb-postcard-art" src={face.art.canvas} alt="" aria-hidden="true" draggable={false} /> : null}
      {/*
        * WCAG 2.5.3 (Label in Name): a button's visible words must appear, in order and together, in its
        * name (`cardLabel`). So the name is drawn before the tag and the tagline in the markup, with a space
        * between (every part is placed, so the order is not the eye's), and every word stays real text.
        */}
      <span className="kb-postcard-name" aria-hidden="true" data-kb-art>{face.name}</span>
      {' '}
      {size !== 'slot' && <span className="kb-postcard-tag" aria-hidden="true" data-kb-art>{face.tag}</span>}
      {' '}
      {/* How it is played, in its word, and how rare it is, as a gem whose shape says it (the card mechanic's design, sections 1 and 2). */}
      {/* In a slot the word is drawn by CSS from its attribute: the slot's button is named by its own words (Vending.tsx), which say the play after the price. */}
      {size === 'slot'
        ? <span className="kb-postcard-play" aria-hidden="true" data-kb-art data-kb-word={playWord(face.play)} />
        : <span className="kb-postcard-play" aria-hidden="true" data-kb-art>{playWord(face.play)}</span>}
      {' '}
      <span className="kb-postcard-gem" aria-hidden="true" data-kb-rarity={face.rarity} data-kb-gem={gemOf(face.rarity)} title={rarityName(face.rarity)} />
      {' '}
      {size === 'sheet' && (
        <span className="kb-postcard-price kb-num" aria-hidden="true" data-kb-art><span className="kb-postcard-orb" />{priceOf(face)}</span>
      )}
      {size === 'fan' && face.tagline && <span className="kb-postcard-line" aria-hidden="true" data-kb-art>{face.tagline}</span>}
      {size === 'sheet' && <span className="kb-postcard-line" aria-hidden="true" data-kb-art>{face.summary}</span>}
      {size === 'sheet' && (
        <span className="kb-postcard-foot" aria-hidden="true" data-kb-art>
          <span>Postcard</span>
          <span>{face.stack > 1 ? `Stacks ${face.stack} deep` : 'One per post'}</span>
        </span>
      )}
    </As>
  );
}
