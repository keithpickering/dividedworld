/**
 * One IntersectionObserver for every Feelin' Fab on the page (docs/plans/2026-11-02-onboarding-design.md, section 6): a post's rainbow
 * animates only while the post is in view, and a page of posts shares one observer rather than carrying one each. The observer is made
 * with the first post watched and dropped with the last. Where the browser has no IntersectionObserver, a post counts as in view, so the
 * rainbow runs rather than freezing.
 */
import { useEffect, useState, type RefObject } from 'react';

type Watcher = (inView: boolean) => void;

let observer: IntersectionObserver | null = null;
const watchers = new Map<Element, Watcher>();

/** Calls `onChange` with whether `el` is in view now and whenever that changes; the returned function stops watching. */
export function watchInView(el: Element, onChange: Watcher): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => {};
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) watchers.get(entry.target)?.(entry.isIntersecting);
  });
  watchers.set(el, onChange);
  observer.observe(el);
  return () => {
    watchers.delete(el);
    observer?.unobserve(el);
    if (watchers.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/** Whether the element is in view: false until the observer says so, or true at once where there is no observer. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    return el ? watchInView(el, setInView) : undefined;
  }, [ref]);
  return inView;
}
