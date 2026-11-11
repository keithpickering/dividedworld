/**
 * What a screen says in place of "none of your characters can post yet" when the player's own rows could not be read
 * (`charactersFailed`): the list is empty for want of a read, not because there are none, so nothing here tells the
 * player to make a character. Try again reads the rows once more.
 */
import { usePlayer } from '../player.tsx';

export function CharactersFailed({ className }: { readonly className?: string }) {
  const { refresh } = usePlayer();
  return (
    <p className={className} role="status">
      Your characters couldn't be loaded. <button type="button" className="kb-button" onClick={() => void refresh()}>Try again</button>
    </p>
  );
}
