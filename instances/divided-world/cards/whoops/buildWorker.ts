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

/** Answer builds on `scope`. A build that throws is answered `failed`, so the page is never left waiting. */
export function serveBuilds(scope: BuildScope): void {
  scope.onmessage = (e) => {
    const { id, input } = e.data;
    try {
      const built = buildLayer(input);
      scope.postMessage({ kind: 'built', id, built }, [built.field.buffer, built.washed.buffer, built.image.data.buffer]);
    } catch (err) {
      scope.postMessage({ kind: 'failed', id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}

const scope = globalThis as unknown as { WorkerGlobalScope?: new () => object; self?: object };
if (scope.WorkerGlobalScope && scope.self instanceof scope.WorkerGlobalScope) serveBuilds(scope.self as unknown as BuildScope);
