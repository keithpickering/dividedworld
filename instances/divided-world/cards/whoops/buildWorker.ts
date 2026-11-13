/**
 * The build worker's entry (ink-field design, section 5): the page starts it with
 * `new Worker(new URL('./buildWorker.ts', import.meta.url), { type: 'module' })` (buildClient.ts) and Vite bundles it as a
 * same-origin script. It answers each `build` message with `buildLayer`'s result, its three buffers transferred.
 */
import { buildLayer, type BuildInput, type Built } from './build.ts';

export interface ToBuild { readonly kind: 'build'; readonly id: number; readonly input: BuildInput }
export type FromBuild =
  | { readonly kind: 'built'; readonly id: number; readonly built: Built }
  | { readonly kind: 'failed'; readonly id: number; readonly message: string };

export interface BuildScope {
  onmessage: ((e: { data: ToBuild }) => void) | null;
  postMessage(message: FromBuild, transfer?: Transferable[]): void;
}

/** Answer builds on `scope`, each timed by `now` (`performance.now` by default). A build that throws is answered `failed`, so the page is never left waiting. */
export function serveBuilds(scope: BuildScope, now?: () => number): void {
  scope.onmessage = (e) => {
    const m = e?.data as Partial<ToBuild> | null | undefined;
    const id = typeof m?.id === 'number' ? m.id : undefined;
    try {
      if (!m || m.kind !== 'build' || id === undefined || !m.input) throw new Error('a malformed build message');
      const built = buildLayer(m.input, now);
      scope.postMessage({ kind: 'built', id, built }, [built.field.buffer, built.washed.buffer, built.image.data.buffer]);
    } catch (err) {
      /* A message with no id has nobody waiting on it: ignored. */
      if (id !== undefined) scope.postMessage({ kind: 'failed', id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}

const scope = globalThis as unknown as { WorkerGlobalScope?: new () => object; self?: object };
if (scope.WorkerGlobalScope && scope.self instanceof scope.WorkerGlobalScope) serveBuilds(scope.self as unknown as BuildScope);
