/**
 * What a screen says in place of "none of your characters can post yet" when the player's own rows could not be read
 * (`charactersFailed`): the list is empty for want of a read, not because there are none, so nothing here tells the
 * player to make a character. Try again reads the rows once more, and is off while that read is out. It is drawn on the
 * board skin's pages (Composer, NewThread, SpinForm, Log), so its button is the board's `kb-button`; the HUD draws its own
 * with the glass button.
 */
import { useState } from 'react';
import { usePlayer } from '../player.tsx';
import { readBack } from './readBack.ts';

export function CharactersFailed({ className }: { readonly className?: string }) {
  const { refresh } = usePlayer();
  const [busy, setBusy] = useState(false);
  const again = () => { setBusy(true); void readBack(refresh).finally(() => setBusy(false)); };
  return (
    <p className={className} role="status">
      Your characters couldn't be loaded. <button type="button" className="kb-button" disabled={busy} onClick={again}>Try again</button>
    </p>
  );
}
