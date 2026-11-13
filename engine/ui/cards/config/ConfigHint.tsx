/**
 * A line of quiet words in a card's settings (`kb-play-fine`, the play form's fine print). `live` makes it a status, for words that change as the
 * player acts (a total, "all five cues are filled"), so a reader hears them; without it the line is plain text.
 */
import type { ReactNode } from 'react';

export interface ConfigHintProps {
  readonly children: ReactNode;
  readonly id?: string;
  readonly live?: boolean;
}

export function ConfigHint({ children, id, live }: ConfigHintProps) {
  return <p id={id} className="kb-play-fine" role={live ? 'status' : undefined}>{children}</p>;
}
