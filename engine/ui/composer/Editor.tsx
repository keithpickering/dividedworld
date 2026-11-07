/**
 * The writing box the quick reply and an edit share: the toolbar, the text box, its count against
 * the longest post, and an in-place preview drawn by the same renderer the thread draws a post
 * with (so the preview is the post), with the same quote links.
 */
import { useEffect, useId, useLayoutEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { quoteHead } from '../thread/lines.tsx';
import { Toolbar } from './Toolbar.tsx';
import { videoOf } from '../../bbcode/video.ts';
import { safeImageSrc } from '../../bbcode/parse.ts';
import { QuoteSomeone } from './QuoteSomeone.tsx';
import { applyTool, diffRange, quoteSomeone, type Tool } from './text.ts';
import './composer.css';

export interface EditorHandle {
  /** Focus the box with the cursor at `at` (the end by default). */
  focus(at?: number): void;
  /** Make the box hold `next`, as an insertion the browser can undo, with the cursor at `at` (the end by default). */
  set(next: string, at?: number): void;
}

export interface EditorProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly max: number;
  readonly onQuote?: (() => void) | undefined;
  /** Ctrl or Command with Enter. */
  readonly onSubmit?: () => void;
  readonly describedBy?: string | undefined;
  /** What Ctrl or Command with Enter does, for the hint beside the count ("sends", "saves"). */
  readonly submitVerb?: string;
  /** A plain line beside the count, spoken when it appears; the region it lives in is always there. */
  readonly note?: ReactNode;
  readonly autoFocus?: boolean;
  /** The buttons beside the count and the preview toggle. */
  readonly children?: ReactNode;
  readonly ref?: Ref<EditorHandle>;
}

const count = (s: string) => [...s].length;

/** What a paste of this text could become: a video, an image, or nothing (a sentence, a page link, an address that is not https). */
function embeddable(pasted: string): { readonly url: string; readonly kind: 'video' | 'image' } | null {
  const url = pasted.trim();
  if (url === '' || /\s/u.test(url) || safeImageSrc(url) === null) return null;
  if (videoOf(url) !== null) return { url, kind: 'video' };
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && /\.(?:png|jpe?g|gif|webp)$/iu.test(u.pathname)) return { url, kind: 'image' };
  } catch { /* not an address */ }
  return null;
}

/** A pasted address still where it landed: `at` is its offset in the box. */
interface Offer { readonly url: string; readonly kind: 'video' | 'image'; readonly at: number }

/** The Mac keeps Control for its own text editing; its shortcut key is Command. Read when a key is pressed, never at load. */
const onMac = () => {
  try {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad/iu.test(nav.userAgentData?.platform ?? navigator.platform ?? '');
  } catch { return false; }
};

const SHORTCUTS: Record<string, Tool> = { b: 'bold', i: 'italic', u: 'underline', k: 'link' };

export function Editor({ label, value, onChange, max, onQuote, onSubmit, describedBy, submitVerb = 'sends', note, autoFocus, children, ref }: EditorProps) {
  const box = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const [, bump] = useState(0);
  const [preview, setPreview] = useState(false);
  const [someone, setSomeone] = useState<{ start: number; end: number } | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  /* True from a paste until the change event it causes, which is not an edit that withdraws the offer. */
  const pasting = useRef(false);
  const previewId = useId();
  const hintId = useId();

  /* The cursor goes where a tool or a quote left it, after the new text is in the box. */
  useLayoutEffect(() => {
    const at = pending.current;
    const el = box.current;
    if (!at || !el) return;
    pending.current = null;
    el.focus();
    el.setSelectionRange(at.start, at.end);
  });
  useLayoutEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);
  /**
   * Put `next` in the box. Through the browser's own insertion (a selection and `insertText`) its
   * undo keeps the text from before, and the input event it fires is what React's onChange hears;
   * where there is none (a test's DOM), the text is set through state, which loses native undo.
   */
  const put = (next: string, at: { start: number; end: number }) => {
    const el = box.current;
    pending.current = at;
    if (!el) { onChange(next); return; }
    const was = el.value;
    if (was !== next) {
      const d = diffRange(was, next);
      let done = false;
      if (d.insert !== '') {
        try {
          el.focus();
          el.setSelectionRange(d.start, d.end);
          done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, d.insert);
        } catch { done = false; }
      }
      if (!done) onChange(next);
    }
    bump((n) => n + 1);
  };
  useImperativeHandle(ref, () => ({
    focus(at) {
      const end = at ?? box.current?.value.length ?? 0;
      pending.current = { start: end, end };
      bump((n) => n + 1);
    },
    set(next, at) {
      const end = at ?? next.length;
      put(next, { start: end, end });
    },
  }));

  const tool = (t: Tool) => {
    const el = box.current;
    if (!el) return;
    const done = applyTool(t, el.value, el.selectionStart, el.selectionEnd);
    put(done.text, { start: done.start, end: done.end });
  };
  /* The character is chosen with the dialog still up (the box behind it is inert); the insertion waits for the dialog to be gone. */
  const chosen = useRef<{ id: string; name: string } | null>(null);
  const picked = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const closeSomeone = (character: { id: string; name: string } | null) => {
    chosen.current = character;
    setSomeone(null);
  };
  /* True from the dialog opening until its close has been dealt with, so a mount (which also runs the effect below) returns focus to nobody. */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (someone !== null) return;
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = box.current;
    if (!el) return;
    const character = chosen.current;
    chosen.current = null;
    /* After the modal has given focus back to the button that opened it. */
    queueMicrotask(() => {
      if (character) {
        const done = quoteSomeone(el.value, picked.current.start, picked.current.end, character);
        put(done.text, { start: done.start, end: done.end });
      } else if (picked.current.end >= 0) {
        el.focus();
        el.setSelectionRange(picked.current.start, picked.current.end);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [someone]);
  const openSomeone = () => {
    const el = box.current;
    picked.current = { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
    wasOpen.current = true;
    setSomeone(picked.current);
  };

  const paste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    const found = embeddable(text);
    if (!found) { setOffer(null); return; }
    pasting.current = true;
    /* A paste that fires no change (blocked or cut short) must not swallow the next real edit. */
    setTimeout(() => { pasting.current = false; }, 0);
    setOffer({ ...found, at: e.currentTarget.selectionStart + text.indexOf(found.url) });
  };
  const embed = () => {
    const el = box.current;
    const was = offer;
    setOffer(null);
    if (!el || !was || el.value.slice(was.at, was.at + was.url.length) !== was.url) return;
    const done = applyTool(was.kind === 'video' ? 'video' : 'image', el.value, was.at, was.at + was.url.length);
    const after = done.end + (was.kind === 'video' ? '[/video]' : '[/img]').length;
    put(done.text, { start: after, end: after });
  };
  const keep = () => { setOffer(null); box.current?.focus(); };

  const keys = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = onMac() ? e.metaKey : e.ctrlKey || e.metaKey;
    const shortcut = mod && !e.altKey && !e.shiftKey ? SHORTCUTS[e.key.toLowerCase()] : undefined;
    if (shortcut) { e.preventDefault(); tool(shortcut); return; }
    if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit(); }
  };

  const n = count(value);
  const over = n - max;
  return (
    <div className="kb-editor">
      <Toolbar onTool={tool} onQuote={onQuote} onSomeone={openSomeone} />
      <textarea
        ref={box}
        className="kb-textarea kb-editor-box"
        aria-label={label}
        aria-describedby={[describedBy, onSubmit ? hintId : undefined].filter(Boolean).join(' ') || undefined}
        rows={5}
        value={value}
        onChange={(e) => { if (pasting.current) pasting.current = false; else setOffer(null); onChange(e.target.value); }}
        onKeyDown={keys}
        onPaste={paste}
      />
      <div className="kb-editor-offer kb-small" role="status">
        {offer && (
          <>
            <span>{offer.kind === 'video' ? 'Embed this video?' : 'Show this image?'}</span>
            <button type="button" className="kb-button" onClick={embed}>Embed</button>
            <button type="button" className="kb-button" onClick={keep}>Keep as link</button>
          </>
        )}
      </div>
      <div className="kb-editor-foot">
        <span className={`kb-editor-count kb-small kb-num${over > 0 ? ' kb-editor-over' : ''}`}>{over > 0 ? `${n} of ${max} — ${over} over` : `${n} of ${max}`}</span>
        {onSubmit && <span id={hintId} className="kb-editor-hint kb-small kb-muted">Ctrl+Enter or Command+Enter {submitVerb}</span>}
        <span className="kb-editor-note kb-small" role="status">{note}</span>
        <button type="button" className="kb-button" aria-pressed={preview} aria-controls={previewId} onClick={() => setPreview(!preview)}>Preview</button>
        {children}
      </div>
      {someone && <QuoteSomeone onChoose={closeSomeone} onClose={() => closeSomeone(null)} returnFocusTo={() => box.current} />}
      <div id={previewId}>
        {preview && (
          <section className="kb-editor-preview" aria-label="Preview">
            {value.trim() === '' ? <p className="kb-muted">Nothing to preview yet.</p> : <BbCode text={value} quoteHead={quoteHead} />}
          </section>
        )}
      </div>
    </div>
  );
}
