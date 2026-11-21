/**
 * The commentary nodes (docs/plans/2026-11-21-commentary-video-design.md, section 1): the floating speech-bubble symbols of a developer
 * commentary track, drawn over the stage's page. A node is a button with a name, bobbing where it hangs; a click starts it, and it turns
 * slowly while it plays, and a second click stops it, as the commentary's welcome says. The bubble is drawn here, in the page's own
 * `--kb-` tokens, so a node takes the skin's colors as the board around it does.
 *
 * They are the stage's and exist in no other story: nothing draws one until a shot places it (`window.__shot.node`), so every state
 * the stage rests in, and every other story, has none. The store is plain, with no React in it, so a shot places a node from outside.
 */
import { useSyncExternalStore } from 'react';
import './hype.css';

/** A node on the page: where it hangs, in page pixels from the top left of the document, and whether it is playing. */
export interface NodeState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly started: boolean;
}

/** The page's nodes, and what a shot does to them. */
export function createNodes() {
  let list: readonly NodeState[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const set = (to: readonly NodeState[]) => { list = to; for (const l of [...listeners]) l(); };
  return {
    list: () => list,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    /** Hangs a node at a point of the page; returns its id. */
    add(x: number, y: number): number { const id = next++; set([...list, { id, x, y, started: false }]); return id; },
    /** A click: an idle node starts, a playing one stops. */
    toggle(id: number) { set(list.map((n) => (n.id === id ? { ...n, started: !n.started } : n))); },
    clear() { set([]); },
  };
}
export type NodeStore = ReturnType<typeof createNodes>;

/** The stage's one store. */
export const nodes: NodeStore = createNodes();

/** The nodes over the page, or nothing at all while there are none. Placed in the board's plane, so a turned board carries them with it. */
export function Nodes() {
  const list = useSyncExternalStore(nodes.subscribe, nodes.list, nodes.list);
  if (list.length === 0) return null;
  return (
    <div className="dw-hype-nodes" data-hype-nodes="">
      {list.map((n) => (
        <button key={n.id} type="button" className="dw-hype-node" aria-label="Commentary node" aria-pressed={n.started} data-hype-node={n.id} {...(n.started ? { 'data-started': '' } : {})} style={{ left: n.x, top: n.y }} onClick={() => nodes.toggle(n.id)}>
          <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <circle className="dw-hype-node-ring" cx="32" cy="32" r="29" />
            <path className="dw-hype-node-bubble" d="M14 15h36a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H36l-10 9v-9H14a6 6 0 0 1-6-6V21a6 6 0 0 1 6-6z" />
            <circle className="dw-hype-node-dot" cx="21" cy="30" r="3" />
            <circle className="dw-hype-node-dot" cx="32" cy="30" r="3" />
            <circle className="dw-hype-node-dot" cx="43" cy="30" r="3" />
          </svg>
        </button>
      ))}
    </div>
  );
}
