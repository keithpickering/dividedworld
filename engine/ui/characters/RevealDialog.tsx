import type { Id, MyCharacter } from '../data/api.ts';
export function RevealDialog(_: { readonly character: MyCharacter; readonly thread?: Id | null; readonly onClose: () => void; readonly onDone?: (message: string) => void }) { return null; }
