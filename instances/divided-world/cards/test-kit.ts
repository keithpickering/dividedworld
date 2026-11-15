/**
 * Helpers the card tests share: the post target a play lands on, a post's own words, a card looked up by key, Jimmy
 * Wails's rules and Graffiti's surface. It holds no test. Each helper a single card's tests use stays in that card's
 * `<key>.test.ts`.
 */
import { cards } from './index.ts';
import { graffiti } from './graffiti.ts';
import { postTarget, type CardTarget } from '../../../engine/rules/cards.ts';

export const post = (length: number): CardTarget => ({ reach: 'post', act: 'p1', kind: 'post', length, text: '', links: [] });

export const on = (body: string): CardTarget => postTarget('p1', 'post', body);

export const by = (key: string) => cards.find((c) => c.key === key)!;

export const jimmy = () => cards.find((c) => c.key === 'jimmy-wails')!;

export const surf = graffiti.surface!;
