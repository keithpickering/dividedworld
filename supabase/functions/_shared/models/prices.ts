/**
 * What a call costs, priced from the provider's own usage block ("Cost is a column, not a
 * report"): one table per provider, each with the date it was verified, priced per million tokens
 * by the service tier the usage block reports (the tier reported is the sole authority on what was
 * billed, whatever the request asked for) and, for the self-hosted completions endpoint, per GPU
 * second. A model, a tier or a provider missing from its table throws: an unpriced call
 * disappearing from the budget is the silent failure the ledger exists to prevent, and a price of
 * zero is only ever an entry that says so.
 *
 * Microdollars are whole: a USD-per-million rate times a token count is exactly microdollars, and
 * a call's total is rounded up to the next whole one, so no call prices below what it cost.
 *
 * The Anthropic table was read on 2026-10-31 from the claude-api skill (its pricing table, cached
 * 2026-10-06), which is where model ids come from too. The skill gives no priority-tier price for
 * any model (and says a priority request naming Opus 5.5 or Sonnet 5.5 fails validation), so the
 * shipped table has no priority rows: a usage block that reports priority throws "tier missing"
 * until a row is read from the provider's own page and added with a new `verifiedOn`. The table
 * drifts, so the ledger is reconciled against the provider's bill monthly.
 */
import type { Usage } from '../../../../engine/system/model.ts';

/** USD per million tokens. */
export interface TokenRates {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

export interface TokenModelPrice {
  readonly tiers: Readonly<Record<string, TokenRates>>;
  /** Rates that replace `tiers` when the whole prompt (input plus cache) is over `aboveTokens`. */
  readonly longContext?: { readonly aboveTokens: number; readonly tiers: Readonly<Record<string, TokenRates>> };
}

export interface TokenPriceTable {
  readonly provider: string;
  readonly verifiedOn: string;
  readonly unit: 'perMillionTokens';
  readonly models: Readonly<Record<string, TokenModelPrice>>;
}

export interface GpuPriceTable {
  readonly provider: string;
  readonly verifiedOn: string;
  readonly unit: 'perGpuSecond';
  /** USD per GPU second, by the tier the adapter reports. */
  readonly models: Readonly<Record<string, { readonly tiers: Readonly<Record<string, { readonly perGpuSecond: number }>> }>>;
}

export type PriceTable = TokenPriceTable | GpuPriceTable;

const half = (r: TokenRates): TokenRates => ({ input: r.input / 2, output: r.output / 2, cacheRead: r.cacheRead / 2, cacheWrite5m: r.cacheWrite5m / 2, cacheWrite1h: r.cacheWrite1h / 2 });
const rates = (input: number, output: number, cacheRead: number, cacheWrite5m: number, cacheWrite1h: number): TokenRates => ({ input, output, cacheRead, cacheWrite5m, cacheWrite1h });
const standardAndBatch = (standard: TokenRates) => ({ standard, batch: half(standard) });

const ANTHROPIC: TokenPriceTable = {
  provider: 'anthropic',
  verifiedOn: '2026-10-31',
  unit: 'perMillionTokens',
  models: {
    'claude-opus-5-5': { tiers: standardAndBatch(rates(4.0, 20.0, 0.2, 5.0, 8.0)) },
    'claude-sonnet-5-5': { tiers: standardAndBatch(rates(2.0, 10.0, 0.2, 2.5, 4.0)) },
    'claude-haiku-5-5': {
      tiers: standardAndBatch(rates(0.1, 0.5, 0.01, 0.125, 0.2)),
      longContext: { aboveTokens: 100_000, tiers: standardAndBatch(rates(0.5, 2.5, 0.05, 0.625, 1.0)) },
    },
  },
};

/** A server the instance runs itself costs the instance nothing per call: an explicit zero, not a missing row. */
const COMPLETIONS: GpuPriceTable = {
  provider: 'completions',
  verifiedOn: '2026-10-31',
  unit: 'perGpuSecond',
  models: { 'self-hosted': { tiers: { 'self-hosted': { perGpuSecond: 0 } } } },
};

export const PRICES = { anthropic: ANTHROPIC, completions: COMPLETIONS } as const satisfies Record<string, PriceTable>;

/** The cost in whole microdollars. `table` defaults to the provider's shipped one; a test passes its own. */
export function price(provider: string, model: string, usage: Usage, table: PriceTable | undefined = (PRICES as Record<string, PriceTable>)[provider]): number {
  if (!table) throw new Error(`no price table for the provider ${provider}`);
  const entry = (table.models as Record<string, unknown>)[model];
  if (!entry) throw new Error(`the ${provider} price table (verified ${table.verifiedOn}) has no model ${model}`);
  const tier = usage.serviceTier;
  if (!tier) throw new Error(`the usage block for ${provider} ${model} reports no service tier`);
  let microdollars: number;
  if (table.unit === 'perGpuSecond') {
    const row = (entry as GpuPriceTable['models'][string]).tiers[tier];
    if (!row) throw new Error(`the ${provider} price table has no tier ${tier} for ${model}`);
    microdollars = (usage.gpuSeconds ?? 0) * row.perGpuSecond * 1_000_000;
  } else {
    const e = entry as TokenModelPrice;
    const prompt = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWrite5mTokens ?? 0) + (usage.cacheWrite1hTokens ?? 0);
    const tiers = e.longContext && prompt > e.longContext.aboveTokens ? e.longContext.tiers : e.tiers;
    const row = tiers[tier];
    if (!row) throw new Error(`the ${provider} price table has no tier ${tier} for ${model}`);
    microdollars = (usage.inputTokens ?? 0) * row.input + (usage.outputTokens ?? 0) * row.output + (usage.cacheReadTokens ?? 0) * row.cacheRead
      + (usage.cacheWrite5mTokens ?? 0) * row.cacheWrite5m + (usage.cacheWrite1hTokens ?? 0) * row.cacheWrite1h;
  }
  // toFixed(6) first, so a float's dust (0.30000000000000004) is not rounded up to a microdollar nobody owes.
  return Math.ceil(Number(microdollars.toFixed(6)));
}
