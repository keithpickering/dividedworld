/**
 * The shapes of an email: what an instance gives the shell (a theme) and what a message gives it
 * (blocks). The shell is a fixed frame drawn around a fixed set of typed blocks, so a future
 * email adds a block type and never forks the frame (design 2026-11-07-glass-mail, section 2).
 *
 * Everything here is data. Nothing names an instance, and nothing touches a DOM or a vendor
 * client, so Node, Deno and Vite can all import it ("Portable by construction").
 */

/** What an instance supplies: its words, its address, its files and its colors. */
export interface MailTheme {
  /** The instance's name: the masthead and the foot write it, as live text. */
  readonly name: string;
  /** An absolute https URL. The foot links to it. */
  readonly site: string;
  /** Absolute https URLs of the four static images. The same bytes go to every recipient. */
  readonly assets: {
    readonly smoke: string;
    readonly cutPanel: string;
    readonly cutButton: string;
    readonly coin: string;
  };
  /** Web fonts for the clients that load them (Apple Mail, iOS Mail, Samsung, Thunderbird). */
  readonly fonts: readonly {
    readonly family: string;
    readonly url: string;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
  }[];
  /** Full CSS font stacks, fallbacks included: a bare web font makes Outlook use Times. */
  readonly stacks: { readonly display: string; readonly body: string };
  /** Six-digit hex colors. The shell writes only these, or `blend` of two of them. */
  readonly colors: {
    readonly ground: string;
    readonly field: string;
    readonly text: string;
    readonly text2: string;
    readonly hi: string;
    readonly pale: string;
    readonly neon: string;
    readonly neonText: string;
    readonly violet: string;
    readonly ink: string;
  };
}

export type Block =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'code'; readonly label: string; readonly code: string }
  | { readonly type: 'button'; readonly label: string; readonly href: string }
  | { readonly type: 'facts'; readonly rows: readonly (readonly [label: string, value: string])[] }
  | { readonly type: 'quote'; readonly label: string; readonly words: string }
  | { readonly type: 'note'; readonly text: string };

export interface Mail {
  readonly subject: string;
  readonly preheader: string;
  readonly blocks: readonly Block[];
}
