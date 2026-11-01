/**
 * Outside material The System reads, as feed URLs: plain code fetches them and hands the meeting
 * text; no model searches the web (design, section 4: "Portable by construction"). A starting
 * list for the MFGG and Minus World community's wheelhouse (Mario fangames, game making, retro
 * and Nintendo games), all public RSS from game news sites, checked to answer on 2026-10-31.
 * Admins add and remove feeds; a feed that stops answering costs the meeting its sample of
 * outside material for that day and nothing more.
 */
import type { FeedSource } from '../../../engine/rules/types.ts';

export const feeds: readonly FeedSource[] = Object.freeze([
  Object.freeze({ name: 'Nintendo Life', url: 'https://www.nintendolife.com/feeds/latest' }),
  Object.freeze({ name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed' }),
  Object.freeze({ name: 'Ars Technica: Gaming', url: 'https://feeds.arstechnica.com/arstechnica/gaming' }),
]);
