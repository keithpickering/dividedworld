/**
 * The formatting toolbar: one stop on the Tab order, with the arrow keys, Home and End moving along
 * it (the toolbar pattern), each button a real button with a name. Pressing one hands the tool to
 * the box, which wraps the selection.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Tool } from './text.ts';

interface Entry {
  readonly tool: Tool | 'quote';
  readonly name: string;
  readonly show: ReactNode;
}

const ENTRIES: readonly Entry[] = [
  { tool: 'bold', name: 'Bold', show: <b>B</b> },
  { tool: 'italic', name: 'Italic', show: <i>I</i> },
  { tool: 'underline', name: 'Underline', show: <u>U</u> },
  { tool: 'strike', name: 'Strikethrough', show: <s>S</s> },
  { tool: 'link', name: 'Link', show: 'Link' },
  { tool: 'image', name: 'Image', show: 'Image' },
  { tool: 'quote', name: 'Quote the latest post', show: 'Quote' },
  { tool: 'code', name: 'Code', show: 'Code' },
  { tool: 'list', name: 'List', show: 'List' },
];

export interface ToolbarProps {
  readonly onTool: (tool: Tool) => void;
  /** Absent where there is no post to quote (an edit): the tool is left out. */
  readonly onQuote?: (() => void) | undefined;
}

export function Toolbar({ onTool, onQuote }: ToolbarProps) {
  const entries = ENTRIES.filter((e) => e.tool !== 'quote' || onQuote);
  const [active, setActive] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const move = (to: number) => {
    const i = (to + entries.length) % entries.length;
    setActive(i);
    bar.current?.querySelectorAll<HTMLButtonElement>('button')[i]?.focus();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') move(active + 1);
    else if (e.key === 'ArrowLeft') move(active - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(entries.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div ref={bar} className="kb-toolbar" role="toolbar" aria-label="Formatting" onKeyDown={key}>
      {entries.map((e, i) => (
        <button
          key={e.tool}
          type="button"
          className="kb-button kb-toolbar-button"
          aria-label={e.name}
          tabIndex={i === active ? 0 : -1}
          onFocus={() => setActive(i)}
          onClick={() => (e.tool === 'quote' ? onQuote?.() : onTool(e.tool))}
        >{e.show}</button>
      ))}
    </div>
  );
}
