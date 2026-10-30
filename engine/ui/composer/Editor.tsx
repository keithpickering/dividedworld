/**
 * The writing box the quick reply and an edit share: the toolbar, the text box, its count against
 * the longest post, and an in-place preview drawn by the same renderer the thread draws a post
 * with (so the preview is the post), with the same quote links.
 */
import { useId, useLayoutEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { quoteLink } from '../thread/lines.tsx';
import { Toolbar } from './Toolbar.tsx';
import { applyTool, diffRange, type Tool } from './text.ts';
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

export function Editor({ label, value, onChange, max, onQuote, onSubmit, describedBy, submitVerb = 'sends', note, autoFocus, children, ref }: EditorProps) {
  const box = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const [, bump] = useState(0);
  const [preview, setPreview] = useState(false);
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
  const keys = (e: KeyboardEvent) => {
    if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit(); }
  };

  const n = count(value);
  const over = n - max;
  return (
    <div className="kb-editor">
      <Toolbar onTool={tool} onQuote={onQuote} />
      <textarea
        ref={box}
        className="kb-textarea kb-editor-box"
        aria-label={label}
        aria-describedby={[describedBy, onSubmit ? hintId : undefined].filter(Boolean).join(' ') || undefined}
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keys}
      />
      <div className="kb-editor-foot">
        <span className={`kb-editor-count kb-small kb-num${over > 0 ? ' kb-editor-over' : ''}`}>{over > 0 ? `${n} of ${max} — ${over} over` : `${n} of ${max}`}</span>
        {onSubmit && <span id={hintId} className="kb-editor-hint kb-small kb-muted">Ctrl+Enter or Command+Enter {submitVerb}</span>}
        <span className="kb-editor-note kb-small" role="status">{note}</span>
        <button type="button" className="kb-button" aria-pressed={preview} aria-controls={previewId} onClick={() => setPreview(!preview)}>Preview</button>
        {children}
      </div>
      <div id={previewId}>
        {preview && (
          <section className="kb-editor-preview" aria-label="Preview">
            {value.trim() === '' ? <p className="kb-muted">Nothing to preview yet.</p> : <BbCode text={value} quoteLink={quoteLink} />}
          </section>
        )}
      </div>
    </div>
  );
}
