/**
 * What the rehearsal's filler is made of (docs/plans/2026-11-11-system-rehearsal-design.md, sections 3 and 7). The engine defines
 * the shapes; an instance exports its own RehearsalContent beside its classes. Pure data: nothing here knows an instance.
 */
import type { Memory } from '../system/memory.ts';

/** An invented character the filler can play: a name, a voice, what it talks about, who it clashes with, and how much it posts. */
export interface Sketch {
  readonly key: string;
  readonly name: string;
  readonly pronouns?: string;
  readonly classKey: string;
  /** One sentence on how it sounds; the corpus drafter's guide and the owner's, never read by the generator. */
  readonly voice: string;
  readonly interests: readonly string[];
  /** Keys of other sketches. */
  readonly feuds: readonly string[];
  readonly postsPerDay: { readonly least: number; readonly most: number };
}

/**
 * A reply line may hold `{name}` (the replied-to character), `{interest}` (one of the poster's) and `{board}`.
 */
export interface RehearsalCorpus {
  readonly sketches: readonly Sketch[];
  readonly openers: Readonly<Record<string, readonly { readonly title: string; readonly body: string }[]>>;
  readonly replies: readonly string[];
  readonly agreeing: readonly string[];
  readonly disagreeing: readonly string[];
}

export interface Scenario {
  readonly key: string;
  readonly seed: number;
  readonly players: number;
  readonly charactersPerPlayer: { readonly least: number; readonly most: number };
  readonly startThreads: number;
  readonly backstoryDays: number;
  /** The day of the season day 1 of the run falls on. */
  readonly dayOfSeason: number;
  readonly days: number;
  readonly postsPerDay: { readonly least: number; readonly most: number };
  readonly reactionsPerPost: { readonly least: number; readonly most: number };
  readonly costCapDollars: number;
  readonly bossMemory?: Memory;
  readonly profile?: 'playtest';
}

/** What an instance exports for the rehearsal. */
export interface RehearsalContent {
  readonly corpus: RehearsalCorpus;
  readonly scenarios: readonly Scenario[];
}
