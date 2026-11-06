/**
 * The foil worker's entry (docs/plans/2026-11-06-shine-design.md section 6): the page starts it with
 * `new Worker(new URL('./foilWorker.ts', import.meta.url), { type: 'module' })` (foilClient.ts) and Vite bundles it as a same-origin
 * script, which the site's `script-src 'self'` allows. All it does is serve foils (foilServe.ts) on this worker's global scope.
 * A story that counts or poisons what the worker does has an entry of its own and gives it to `setFoilWorker`.
 */
import { serveFoils, type FoilScope } from './foilServe.ts';

serveFoils(self as unknown as FoilScope);
