/**
 * The orbs' arithmetic: a wallet in hundredths as orbs of a hundred each, the settled fill solid,
 * the live estimate's gain hatched after it, a loss a pale band over the solid fill it would take,
 * and what would settle past the cap said apart (the screens' design, section 3). Pure, so the
 * HUD's drawing and its accessible name read one answer.
 */

/** One orb's fills, each a fraction of the orb from 0 to 1. */
export interface OrbFill {
  readonly solid: number;
  readonly gainFrom: number;
  readonly gainTo: number;
  readonly lossFrom: number;
  readonly lossTo: number;
}

const ORB = 100;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** How much of orb i a span of hundredths [a, b] covers, as [from, to] fractions of it. */
const within = (i: number, a: number, b: number): [number, number] => {
  const from = clamp(a - i * ORB, 0, ORB) / ORB;
  const to = clamp(b - i * ORB, 0, ORB) / ORB;
  return to > from ? [from, to] : [0, 0];
};

/** Orbs for a settled wallet and a pending estimate (signed hundredths), and what is past the cap. */
export function orbFills(settled: number, pending: number, cap: number): { readonly orbs: readonly OrbFill[]; readonly overflow: number } {
  const count = Math.ceil(cap / ORB);
  const s = clamp(settled, 0, cap);
  const ghost = clamp(s + pending, 0, cap);
  const orbs = Array.from({ length: count }, (_, i) => {
    const [, solid] = within(i, 0, s);
    const [gainFrom, gainTo] = pending > 0 ? within(i, s, ghost) : [0, 0];
    const [lossFrom, lossTo] = pending < 0 ? within(i, ghost, s) : [0, 0];
    return { solid, gainFrom, gainTo, lossFrom, lossTo };
  });
  return { orbs, overflow: Math.max(0, s + pending - cap) };
}

const orbs = (h: number) => (h / ORB).toFixed(2);

/** The wallet as a screen reader hears it: settled, then what is pending and that it is an estimate. */
export function walletName(settled: number, pending: number, cap: number): string {
  const s = clamp(settled, 0, cap);
  const whole = cap % ORB === 0 ? String(cap / ORB) : orbs(cap);
  let name = `Wallet ${orbs(s)} of ${whole} orbs`;
  if (pending > 0) name += `, ${orbs(pending)} pending until the next settlement (estimate)`;
  if (pending < 0) name += `, ${orbs(-pending)} to be lost at the next settlement (estimate)`;
  const over = s + pending - cap;
  if (over > 0) name += `, ${orbs(over)} past the cap`;
  return name;
}

/** One beat of the cascade: which orb, when (ms from its start), and whether it fills, which flashes and shines. */
export interface CascadeStep {
  readonly orb: number;
  readonly at: number;
  readonly fills: boolean;
}

export const CASCADE_BEAT_MS = 1000;

/**
 * The TTYD cascade between two wallets: one orb a second, each orb whose fill changes, in the
 * direction the wallet moved; a gain from the first changed orb up, a spend from the last down.
 */
export function cascade(before: number, after: number, cap: number): readonly CascadeStep[] {
  const a = clamp(before, 0, cap);
  const b = clamp(after, 0, cap);
  if (a === b) return [];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const first = Math.floor(lo / ORB);
  const last = Math.ceil(hi / ORB) - 1;
  const changed = Array.from({ length: last - first + 1 }, (_, k) => first + k);
  const ordered = b > a ? changed : changed.reverse();
  return ordered.map((orb, k) => ({ orb, at: k * CASCADE_BEAT_MS, fills: b > a && b >= (orb + 1) * ORB }));
}
