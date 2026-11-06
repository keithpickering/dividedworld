/**
 * One IntersectionObserver for every Feelin' Fab on the page (docs/plans/2026-11-02-onboarding-design.md, section 6): a post's rainbow
 * animates only while the post is in view, and a page of posts shares one observer rather than carrying one each. The observer is made
 * with the first post watched and dropped with the last. Where the browser has no IntersectionObserver, a post counts as in view, so the
 * rainbow runs rather than freezing: it starts still for one frame, the same on the server and the client, and becomes in view in the effect.
 */
import { useEffect, useState, type RefObject } from 'react';

type Watcher = (inView: boolean) => void;

/**
 * `threshold`: the share that must show to count as in view (default: any of it). An element counts as showing when that share of
 * itself shows, or when what shows of it fills that share of the viewport, so an element taller than the viewport over the
 * threshold still counts. A threshold has its own observer.
 */
export interface WatchOptions { readonly threshold?: number }

interface Shared { observer: IntersectionObserver; watchers: Map<Element, Watcher> }
/** One observer per threshold, so a page of posts watched alike shares one. */
const shared = new Map<number, Shared>();

/** Steps of a tenth, so the callback fires as the visible share grows, whatever the element's height. */
const LADDER: readonly number[] = Object.freeze(Array.from({ length: 11 }, (_, i) => i / 10));

/** Whether the entry's element shows `threshold` of itself, or its visible height fills `threshold` of the viewport. */
function fills(entry: IntersectionObserverEntry, threshold: number): boolean {
  if (entry.intersectionRatio === undefined || entry.intersectionRatio >= threshold) return true;
  const viewport = entry.rootBounds?.height ?? (typeof innerHeight === 'number' ? innerHeight : 0);
  const visible = entry.intersectionRect?.height;
  return viewport > 0 && visible !== undefined && visible / viewport >= threshold;
}

/** Calls `onChange` with whether `el` is in view now and whenever that changes; the returned function stops watching. */
export function watchInView(el: Element, onChange: Watcher, options: WatchOptions = {}): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => {};
  }
  const threshold = Math.min(1, Math.max(0, options.threshold ?? 0));
  let mine = shared.get(threshold);
  if (!mine) {
    const watchers = new Map<Element, Watcher>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        /* Past a threshold, "in view" is the share showing, not any overlap. */
        const showing = entry.isIntersecting && (threshold === 0 || fills(entry, threshold));
        watchers.get(entry.target)?.(showing);
      }
    }, threshold > 0 ? { threshold: [...LADDER] } : undefined);
    mine = { observer, watchers };
    shared.set(threshold, mine);
  }
  const { observer, watchers } = mine;
  watchers.set(el, onChange);
  observer.observe(el);
  return () => {
    watchers.delete(el);
    observer.unobserve(el);
    if (watchers.size === 0 && shared.get(threshold) === mine) {
      observer.disconnect();
      shared.delete(threshold);
    }
  };
}

/** Whether the element is in view: false until the observer says so, or until the effect runs where there is no observer. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const el = ref.current;
    return el ? watchInView(el, setInView) : undefined;
  }, [ref]);
  return inView;
}
