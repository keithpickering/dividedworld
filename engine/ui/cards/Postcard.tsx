/**
 * A postcard's face, drawn the one way wherever a card is shown (the card template design,
 * docs/plans/2026-11-05-card-template-design.md): one 2:3 card at four sizes, a 30-unit border all the way round, a canvas holding
 * the card's art, a ring in the card's own color with its glow, and the pieces of layout A over it. It is shown in the Vending
 * Machine's slot, fanned through the HUD's seam, in the Phone board's card, and large on the hand's sheet. The card's color and ink
 * come from its art (`CardArt`, the instance's data) as two custom properties and the stylesheet reads nothing else, so a card the
 * instance never drew is the glass's own neon.
 *
 * It draws the face and nothing that acts: the caller gives it a `button` (a slot, a card in the hand) or an `article` (the sheet)
 * and the name that element carries, and everything drawn here is for the eye (aria-hidden), since the name and the rules are said
 * once, in words, by the element around it. A card in the machine's slot is the machine's printing (`data-kb-art`, outside the
 * rendered type measurement as the machine's other printing is). `armed` is the state a play waits in, and pulses unless motion is
 * reduced.
 */
import type { CSSProperties, ElementType, HTMLAttributes, Ref } from 'react';
import { gemOf, priceOf, rarityName, type CardFace } from './faces.ts';
import { templateVars, type PostcardSize } from './template.ts';
import './postcard.css';

/** Where the card is drawn: its size and which parts of the face it holds. */
export type { PostcardSize };

export interface PostcardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly face: CardFace;
  readonly size: PostcardSize;
  /** The card's price at the machine, in hundredths, from its on-sale slot (`saleOf`); a sheet draws it in its foot. A face has none: without one the foot has no price. */
  readonly price?: number | null;
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
  if (face.unknown) return face.name;
  const said = `${face.name}, ${face.tag}, ${face.kind}`;
  const shown = size === 'fan' && face.tagline ? `${said}. ${face.tagline}` : said;
  return `${shown}, ${face.rarity} postcard`;
}

export function Postcard({ face, size, price = null, as: As = 'span', armed = false, className, style, ...rest }: PostcardProps) {
  const vars = { ...templateVars(size), '--kb-card-color': face.art.color, '--kb-card-ink': face.art.ink, '--kb-name-chars': face.name.length, ...style } as CSSProperties;
  const { canvas, credit } = face.art;
  return (
    <As
      {...rest}
      className={`kb-postcard${className ? ` ${className}` : ''}`}
      style={vars}
      data-size={size}
      data-kb-card={face.key}
      data-kb-alignment={face.unknown ? undefined : face.alignment}
      data-armed={armed ? '' : undefined}
      data-kb-art={size === 'slot' ? '' : undefined}
    >
      {/* The canvas: the card's ground, a glow in its color and its art, clipped to the canvas's corners. Nothing in it is a word. */}
      <span className="kb-postcard-canvas" aria-hidden="true">
        {canvas ? <img className="kb-postcard-art" src={canvas} alt="" aria-hidden="true" draggable={false} /> : null}
      </span>
      {/*
        * WCAG 2.5.3 (Label in Name): a button's visible words must appear, in order and together, in its
        * name (`cardLabel`). So the name is drawn before the tag and the tagline in the markup, with a space
        * between (every part is placed, so the order is not the eye's), and every word stays real text.
        */}
      <span className="kb-postcard-plate" aria-hidden="true" data-kb-art><span className="kb-postcard-name">{face.name}</span></span>
      {' '}
      {/* The alignment and how it is played, as two badges on the top border; the slot holds neither. */}
      {size !== 'slot' && !face.unknown && (
        <>
          <span className="kb-postcard-badges" aria-hidden="true" data-kb-art>
            <span className="kb-postcard-tag">{face.tag}</span>
            {' '}
            <span className="kb-postcard-play">{face.kind}</span>
          </span>
          {' '}
        </>
      )}
      {/* How rare it is, as a gem whose shape says it (the card mechanic's design, sections 1 and 2). */}
      {!face.unknown && <span className="kb-postcard-gem" aria-hidden="true" data-kb-rarity={face.rarity} data-kb-gem={gemOf(face.rarity)} title={rarityName(face.rarity)} />}
      {' '}
      {size === 'fan' && face.tagline && <span className="kb-postcard-line" aria-hidden="true" data-kb-art>{face.tagline}</span>}
      {size === 'sheet' && <span className="kb-postcard-line" aria-hidden="true" data-kb-art>{face.summary}</span>}
      {size === 'sheet' && (
        <span className="kb-postcard-base" aria-hidden="true" data-kb-art>
          <span className="kb-postcard-foot">
            <span>Postcard · {face.stack > 1 ? `Stacks ${face.stack} deep` : 'One per post'}</span>
            {credit ? <span className="kb-postcard-credit">Art · {credit}</span> : null}
          </span>
          {' '}
          {price !== null && <span className="kb-postcard-price kb-num"><span className="kb-postcard-orb" />{priceOf(price, face.extra)}</span>}
        </span>
      )}
    </As>
  );
}

export interface PostcardBackProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly size: PostcardSize;
  /** The hit pull's back, in the machine's gold. */
  readonly hit?: boolean;
  /** The instance's mark (`InstanceUi.cardBack`), drawn at the back's center; without it the back is the glass's bands alone. */
  readonly mark?: string;
  readonly as?: ElementType;
  readonly ref?: Ref<HTMLElement>;
}

/**
 * A card face down: the same frame and silhouette as a face at any size, with the glass's crossed bands on the canvas and no
 * card's color, key or name, so a back says nothing about the card it is (the design's section 8). The caller names it, as it
 * names a face.
 */
export function PostcardBack({ size, hit = false, mark, as: As = 'span', className, style, ...rest }: PostcardBackProps) {
  return (
    <As
      {...rest}
      className={`kb-postcard kb-postcard-back${className ? ` ${className}` : ''}`}
      style={{ ...templateVars(size), ...style } as CSSProperties}
      data-size={size}
      data-hit={hit ? '' : undefined}
    >
      <span className="kb-postcard-canvas" aria-hidden="true">
        {mark ? <span className="kb-postcard-emblem"><img src={mark} alt="" aria-hidden="true" draggable={false} /></span> : null}
      </span>
    </As>
  );
}
