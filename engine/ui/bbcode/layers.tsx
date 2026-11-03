/**
 * Text layers: what an effect draws over runs of a post's own words, by offset into the post's visible text
 * (engine/bbcode/visible.ts). An effect wraps the post's words (`CardUi.Effect`'s `children`), and the BBCode renderer inside
 * them reads the layers above it, so a card that works on words (an instance's phrase matcher) lays its runs where its rules
 * found them, and the server and the screens agree on where a word is because both read the same walk.
 *
 * Two kinds of run:
 * - **replace**: the run's words are drawn by `render` once, at the run's start, and the renderer draws none of them itself,
 *   even across formatting (half bold, half not). `render` is given the run's plain text.
 * - **wrap**: each piece of the run that lies in one text node is drawn by `render` in place, inside its own formatting, and given
 *   that piece's text. Nothing is skipped.
 *
 * Where runs overlap, a replace run wins over a wrap run, and of two of a kind the one with the higher `z` wins; the lower one is
 * drawn only where it is not covered, each uncovered stretch of it once. A run never reaches into a quote, code, a link or an
 * image, since none of their words are in the visible text. Layers nest: a `TextLayer` inside another adds its runs to those
 * above it, so several effects on one post combine.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface TextRun {
  /** Offsets into the post's visible text: from the run's first character to just past its last. */
  readonly from: number;
  readonly to: number;
  /** Unique among the post's runs; React's key for what `render` draws. */
  readonly key: string;
  /** Its place in the stack: higher is on top. */
  readonly z: number;
  readonly mode: 'replace' | 'wrap';
  /** What stands for the run (replace), or for one piece of it (wrap), given the words it covers. */
  readonly render: (covered: { readonly text: string; readonly key: string }) => ReactNode;
}

const Layers = createContext<readonly TextRun[]>([]);

/** The runs every layer above this point lays over the post's words. */
export const useTextLayers = (): readonly TextRun[] => useContext(Layers);

/** Lays `runs` over the words of the post drawn inside it, on top of any layers above it. */
export function TextLayer({ runs, children }: { readonly runs: readonly TextRun[]; readonly children: ReactNode }) {
  const above = useContext(Layers);
  const all = useMemo(() => (runs.length ? [...above, ...runs] : above), [above, runs]);
  return <Layers.Provider value={all}>{children}</Layers.Provider>;
}

/** A stretch of the visible text and the run drawn there (null where no run is). */
export interface Stretch {
  readonly from: number;
  readonly to: number;
  readonly run: TextRun | null;
}

/** Which of two runs is drawn where both are: a replace run over a wrap run, then the higher `z`, then the later in the list. */
const over = (a: { run: TextRun; i: number }, b: { run: TextRun; i: number }): boolean =>
  a.run.mode !== b.run.mode ? a.run.mode === 'replace' : a.run.z !== b.run.z ? a.run.z > b.run.z : a.i > b.i;

/**
 * The visible text, `length` characters, cut into stretches, each drawn by the run on top there or by none. Consecutive pieces
 * under the same run are one stretch, so a run split by a higher one gives a stretch on each side of it. One sweep over the runs'
 * ends: at each cut only the runs open there are weighed, and one play's runs never overlap each other, so that is a handful
 * however many words a post holds.
 */
export function stretchesOf(length: number, runs: readonly TextRun[]): Stretch[] {
  const kept = runs.map((run, i) => ({ run, i, from: Math.max(0, run.from), to: Math.min(length, run.to) })).filter((r) => r.to > r.from);
  const starts = [...kept].sort((a, b) => a.from - b.from);
  const cuts = [...new Set([0, length, ...kept.flatMap((r) => [r.from, r.to])])].sort((a, b) => a - b);
  const out: Stretch[] = [];
  let open: typeof kept = [];
  let next = 0;
  for (let c = 0; c + 1 < cuts.length; c++) {
    const [from, to] = [cuts[c]!, cuts[c + 1]!];
    open = open.filter((r) => r.to > from);
    while (next < starts.length && starts[next]!.from <= from) open.push(starts[next++]!);
    let top: (typeof kept)[number] | null = null;
    for (const r of open) if (!top || over(r, top)) top = r;
    const run = top?.run ?? null;
    const last = out[out.length - 1];
    if (last && last.run === run && last.to === from) out[out.length - 1] = { ...last, to };
    else out.push({ from, to, run });
  }
  return out;
}
