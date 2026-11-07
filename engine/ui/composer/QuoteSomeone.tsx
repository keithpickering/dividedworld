/**
 * Quote someone…: a small board dialog (modal.tsx) holding the board's combobox over the characters suggest finds (debuted ones only).
 * Choosing one hands the character to the box, which wraps its selection as that character's words; Escape closes it and hands back nothing.
 */
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import { Modal } from '../modal.tsx';
import { BoardCombobox } from '../search/BoardCombobox.tsx';
import { charactersSource } from '../search/suggest.ts';

export interface QuoteSomeoneProps {
  readonly onChoose: (character: { readonly id: string; readonly name: string }) => void;
  readonly onClose: () => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

export function QuoteSomeone({ onChoose, onClose, returnFocusTo }: QuoteSomeoneProps) {
  const { api } = useKayfa();
  const source = useMemo(() => charactersSource(api), [api]);
  return (
    <Modal title="Quote someone" onClose={onClose} returnFocusTo={returnFocusTo}>
      <p className="kb-small kb-muted">Wraps your selection as words this character said. Choose a character who has debuted.</p>
      <BoardCombobox label="Character to quote" showLabel placeholder="Start a name" source={source} onChoose={(option) => onChoose({ id: option.id, name: option.label })} />
      <div className="kb-dialog-actions">
        <button type="button" className="kb-button" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
