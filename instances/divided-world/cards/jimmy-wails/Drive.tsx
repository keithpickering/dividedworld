/**
 * Jimmy Wails's drive (docs/plans/2026-11-03-jimmy-wails-design.md, sections 4 and 7; plan Task 7), in the plain look of the Wikipedia appeal it
 * parodies: the amounts to give as buttons, what reaches the post's author after overhead, what the drive has raised and the donor wall.
 *
 * - **Buttons.** One for each amount the economy offers, each "Give 0.25 Aura to this drive". A button worth more than the reader's wallet is disabled
 *   and says so in its description. A wallet not yet known (null: the reader is signed out, or the header has not loaded it) disables them all with
 *   that said, since a gift cannot be made without a balance to take it from; the reader's own character is the one who gives, so the author reading
 *   their own post sees the buttons too (giving to oneself is allowed, and the overhead makes it cost).
 * - **What arrives.** "0.18 reaches {author} after 25% overhead", for the amount last pointed at or focused (the first until then),
 *   computed with `giftSplit`, the split the database makes. The author's character name is public.
 * - **The result** of a gift goes to a polite live region, and a refusal shows the database's own words there.
 * - **Closed, in the ORIGIN box, or in a moment:** no buttons. A closed drive says "This drive has ended. It raised 4.20 in 11 gifts." and keeps its wall.
 */
import { useId, useState } from 'react';
import { giftSplit } from '../../../../engine/rules/cards.ts';
import type { Drive as DriveOf, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { figure } from '../../../../engine/ui/characters/format.ts';

export interface DriveProps {
  readonly drive: DriveOf;
  /** The post author's character name. */
  readonly author: string;
  /** The amounts a gift may be, in hundredths, in the order they are offered. */
  readonly amounts: readonly number[];
  /** The percentage kept of every gift. */
  readonly overhead: number;
  /** Whether the buttons are drawn at all: not in an ORIGIN box, nor in a play's moment. A closed drive draws none whatever this says. */
  readonly buttons: boolean;
  readonly wallet: EffectProps['wallet'];
  readonly give: EffectProps['give'];
  readonly moreGifts: EffectProps['moreGifts'];
  readonly nameOf: EffectProps['nameOf'];
}

/** "Raised 4.20 in 11 gifts". */
export const raisedWords = (total: number, count: number): string => `${figure(total)} in ${count} ${count === 1 ? 'gift' : 'gifts'}`;

type Result = { readonly refused: boolean; readonly text: string };

export function Drive({ drive, author, amounts, overhead, buttons, wallet, give, moreGifts, nameOf }: DriveProps) {
  const id = useId();
  const [pointed, setPointed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [paging, setPaging] = useState(false);

  const press = async (amount: number) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const answer = await give(drive.id, amount);
    setBusy(false);
    setResult(answer.ok
      ? { refused: false, text: `You gave ${figure(amount)} Aura. ${figure(giftSplit(amount, overhead).arrives)} reached ${author}. You have ${figure(answer.value.balance)} Aura left.` }
      : { refused: true, text: answer.error });
  };

  const more = async () => {
    setPaging(true);
    await moreGifts(drive.id);
    setPaging(false);
  };

  const showing = drive.open && buttons;
  const shown = amounts[pointed] ?? amounts[0] ?? 0;
  const unseen = Math.max(0, drive.count - drive.gifts.length);

  return (
    <div className="dw-jw-drive" data-open={drive.open ? 'true' : 'false'}>
      {drive.open
        ? <p className="dw-jw-total">Raised {raisedWords(drive.total, drive.count)}</p>
        : <p className="dw-jw-total">This drive has ended. It raised {raisedWords(drive.total, drive.count)}.</p>}
      {showing ? (
        <>
          <div className="dw-jw-give" role="group" aria-label="Give to this drive">
            {amounts.map((amount, i) => {
              const short = wallet !== null && amount > wallet.balance;
              const why = wallet === null ? 'Giving is unavailable until your Aura balance shows.' : short ? `You have ${figure(wallet.balance)} Aura, which is not enough for this.` : null;
              const note = `${id}-why-${i}`;
              return (
                <span key={amount} className="dw-jw-amount">
                  <button
                    type="button" className="dw-jw-button" disabled={why !== null || busy} aria-label={`Give ${figure(amount)} Aura to this drive`} aria-describedby={why === null ? undefined : note}
                    onClick={() => { void press(amount); }} onFocus={() => setPointed(i)} onPointerEnter={() => setPointed(i)}
                  >
                    {figure(amount)}
                  </button>
                  {why === null ? null : <span id={note} className="dw-jw-sr">{why}</span>}
                </span>
              );
            })}
          </div>
          <p className="dw-jw-split">{figure(giftSplit(shown, overhead).arrives)} reaches {author} after {overhead}% overhead</p>
        </>
      ) : null}
      <div className="dw-jw-result" role="status" aria-live="polite" data-refused={result?.refused ? 'true' : undefined}>{result?.text ?? ''}</div>
      {drive.gifts.length > 0 ? (
        <ul className="dw-jw-wall" aria-label="Donors, latest first">
          {drive.gifts.map((g) => (
            <li key={g.id}><span className="dw-jw-donor">{g.name ?? nameOf(g.character)}</span> <span className="dw-jw-sum">{figure(g.amount)} Aura</span></li>
          ))}
        </ul>
      ) : null}
      {drive.more ? <button type="button" className="dw-jw-more" disabled={paging} onClick={() => { void more(); }}>{unseen > 0 ? `and ${unseen} more` : 'and more'}</button> : null}
    </div>
  );
}
