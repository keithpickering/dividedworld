/**
 * The state of a post's row for this reader, and the press that changes it, given to a card that folds the row
 * (`CardUi.foldsRow`; `EffectProps.fold`). Null where a post is drawn with no row of its own.
 */
import { createContext, useContext } from 'react';

export interface RowFold { readonly open: boolean; readonly toggle: () => void }

export const RowFoldCtx = createContext<RowFold | null>(null);

export const useRowFold = (): RowFold | null => useContext(RowFoldCtx);
