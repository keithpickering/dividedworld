import type { Id } from '../data/api.ts';
import type { Tallies } from '../thread/tallies.ts';
import type { Mine } from './mine.ts';
export const readable = (key: string): string => key;
export function Reactions(_: { act: Id; author: Id | null; tallies: Tallies; mine: Mine }) { return null; }
