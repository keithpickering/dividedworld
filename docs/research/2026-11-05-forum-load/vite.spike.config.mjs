// Spike harness: the dev app on the in-memory backend, every api promise delayed by ?lat= ms (a simulated round trip), traced on window.__trace.
import { defineConfig } from '/home/user/dividedworld/node_modules/vite/dist/node/index.js';
import react from '/home/user/dividedworld/node_modules/@vitejs/plugin-react/dist/index.js';
const WRAP = `
const __L = Number(new URLSearchParams(globalThis.location.search).get('lat') ?? '100');
globalThis.__trace = [];
globalThis.__muts = [];
new MutationObserver(() => { globalThis.__muts.push(performance.now()); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: false });
function __wrap(api) {
  return new Proxy(api, { get(t, k) {
    const v = t[k];
    if (typeof v !== 'function') return v;
    return (...args) => {
      const r = v.apply(t, args);
      if (!r || typeof r.then !== 'function') return r;
      const rec = { name: String(k), start: performance.now(), end: null, path: location.pathname };
      globalThis.__trace.push(rec);
      return new Promise((res, rej) => r.then((x) => setTimeout(() => { rec.end = performance.now(); res(x); }, __L), (e) => setTimeout(() => { rec.end = performance.now(); rej(e); }, __L)));
    };
  } });
}
export async function createBackend() { return __wrap(await __createBackend()); }
`;
export default defineConfig({
  root: '/home/user/dividedworld/web',
  publicDir: '/home/user/dividedworld/instances/divided-world/ui/public',
  logLevel: 'warn',
  plugins: [react(), { name: 'spike-latency', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('web/src/data/backend.ts')) return null;
    return code.replace('export async function createBackend(', 'async function __createBackend(') + WRAP;
  } }],
  server: { fs: { allow: ['/home/user/dividedworld'] }, port: 5199, strictPort: true },
});
