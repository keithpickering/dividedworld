import type { Id, MyReaction } from '../data/api.ts';
export interface Mine { get(act: Id): readonly MyReaction[]; add(r: MyReaction): boolean; merge(act: Id, rs: readonly MyReaction[]): boolean; subscribe(act: Id, l: () => void): () => void }
export function createMine(): Mine { return { get: () => [], add: () => false, merge: () => false, subscribe: () => () => {} }; }
