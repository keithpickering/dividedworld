/**
 * One read ahead at a time (the warm-reads design, section 4). A pointer's rest or the keyboard's focus reads a page or an
 * overlay's data early, and a browser tab has only so many connections to the API. If every rest started a read, a pointer
 * crossing a board would fill them and a click would wait behind reads nobody wanted. So this gate lets one read ahead be in
 * flight in the document, and one wait: the connection that is left serves the press.
 *
 * - `readAhead(start)` calls `start` at once when none is in flight, and holds the gate until its promise settles, either way,
 *   or until `LOAD_LIMIT_MS` has passed, so a read that never answers does not hold it for good.
 * - With one in flight, `start` is the one waiting, replacing any that waited before; the replaced one is never called. When
 *   the one in flight lets go, the one waiting is called and takes the gate.
 * - The function it returns withdraws: a waiting `start` that is withdrawn is never called. Withdrawing one that has started,
 *   or was replaced, does nothing, and doing it twice is safe. A rest that is left withdraws, and gives up its place.
 * - A `start` that throws before it returns a promise lets the gate go at once.
 *
 * A press does not use the gate at all. A press or a click never waits: it joins its own trigger's read if that is out, or
 * starts its own at once, and that is the callers' business (the router's `Link`, and `usePrepared`'s `open`), not this
 * module's. The router's links and the glass's card triggers share this one gate, because the bound is about the connections,
 * not about what was hovered.
 *
 * It keeps its state in the module, for the document it is loaded in. `LOAD_LIMIT_MS` lives here, and the router re-exports
 * it, so the router and this gate agree on one number without importing each other.
 */

/** How long a load, or a read ahead, may go without an answer before it is given up (twenty seconds). */
export const LOAD_LIMIT_MS = 20_000;

type Start = () => Promise<unknown>;

/** The read holding the gate: a token no other read shares, so a late settle of one let go cannot release the next. */
let holder: object | null = null;
/** The one waiting: its `start`, and the token the withdraw checks. */
let waiting: { readonly start: Start; readonly token: object } | null = null;

function release(token: object): void {
  if (holder !== token) return;
  holder = null;
  const next = waiting;
  waiting = null;
  if (next) run(next.start);
}

function run(start: Start): void {
  const token = {};
  holder = token;
  let promise: Promise<unknown>;
  try {
    promise = start();
  } catch {
    release(token);
    return;
  }
  const timer = setTimeout(() => release(token), LOAD_LIMIT_MS);
  const done = () => { clearTimeout(timer); release(token); };
  promise.then(done, done);
}

export function readAhead(start: Start): () => void {
  if (holder === null) {
    run(start);
    return () => {};
  }
  const token = {};
  waiting = { start, token };
  return () => { if (waiting?.token === token) waiting = null; };
}

/** For tests: empties the gate. */
export function resetReadAhead(): void {
  holder = null;
  waiting = null;
}
