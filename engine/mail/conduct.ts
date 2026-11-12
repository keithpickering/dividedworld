/**
 * The seven moderation emails (conduct design, sections 6 and 7; plan Task 3) as typed blocks for the
 * mail shell. The words are plain, out of character and never the voice of The System or a character
 * ("The fiction may lie; the log never does"). None names the reporter.
 *
 * A template declares its slots, and `renderMail` is strict both ways: a slot the facts lack throws, and
 * a key the facts carry that the template does not use throws too. The second half is a privacy guard:
 * `reportRead` has no slots, so the mail a reporter gets is the same bytes whatever the admin decided,
 * and a caller that tries to pass the outcome in is refused rather than rendered ("A response never
 * proves a private fact"). Slots are text; the shell escapes them.
 *
 * An instance may replace the words of a template (subject, preheader, heading, paragraphs, last note)
 * through `ConductUi.mail`; the facts rows, quote and button stay the engine's. `{slot}` in a word is
 * filled from the facts, and a slot the template does not have is refused.
 */
import type { Block, Mail } from './types.ts';

export const CONDUCT_TEMPLATES = ['reportRead', 'nudge', 'hidden', 'hiddenUntilEdited', 'suspended', 'banned', 'lifted'] as const;
export type ConductTemplate = (typeof CONDUCT_TEMPLATES)[number];

export interface ConductWords {
  readonly subject?: string;
  readonly preheader?: string;
  readonly heading?: string;
  readonly paragraphs?: readonly string[];
  /** The email's last sentence. */
  readonly note?: string;
}
export type ConductMailOverride = Partial<Record<ConductTemplate, ConductWords>>;

interface Template {
  readonly slots: readonly string[];
  readonly words: Required<ConductWords>;
}

const CONDUCT_NOTE = 'The code of conduct: {conduct}';
const APPEAL = 'If you think an admin got this wrong, reply to this email and a person will read it.';

export const TEMPLATES: Readonly<Record<ConductTemplate, Template>> = {
  reportRead: {
    slots: [],
    words: {
      subject: 'Your report was read by an admin',
      preheader: 'Thanks for telling us.',
      heading: 'Your report was read by an admin.',
      paragraphs: [
        'Thanks for telling us. A person, not the game, read the post you reported and decided what to do about it.',
        "We don't share what happens to another player's account, the same way we'd never share yours, so you won't hear the outcome from us. If it keeps happening, report it again. Every report is read.",
      ],
      note: '',
    },
  },
  nudge: {
    slots: ['post', 'thread', 'section', 'note', 'conduct'],
    words: {
      subject: 'A note from an admin about your post',
      preheader: 'An admin read a post of yours and left you a note.',
      heading: 'A note about your post',
      paragraphs: [
        'An admin read one of your posts and has a note for you. Nothing has been done to your post or to your account.',
        `The post, the part of the code of conduct the note is about, and the note itself are below. ${APPEAL}`,
      ],
      note: CONDUCT_NOTE,
    },
  },
  hidden: {
    slots: ['post', 'thread', 'section', 'note', 'conduct', 'words'],
    words: {
      subject: 'An admin hid your post',
      preheader: 'Your post broke the code of conduct.',
      heading: 'Your post was hidden',
      paragraphs: [
        "An admin hid your post because it broke the code of conduct. The post is still in its place in the thread with a note saying so, but its words are no longer shown to other players. Nothing was deleted, and an admin can bring it back.",
        `Which post, which rule and the admin's note are below, with your words as they were. ${APPEAL}`,
      ],
      note: CONDUCT_NOTE,
    },
  },
  hiddenUntilEdited: {
    slots: ['post', 'thread', 'section', 'note', 'conduct', 'words'],
    words: {
      subject: 'Your post is hidden until you edit it',
      preheader: 'Edit it and it comes back.',
      heading: 'Your post is hidden until you edit it',
      paragraphs: [
        "An admin hid your post because part of it broke the code of conduct. The whole post doesn't need to go: edit it, and it comes back.",
        `Use the button to open the post and change what the admin's note describes. If a post of yours has been hidden this way before, an admin has to approve the edit before it shows again. ${APPEAL}`,
      ],
      note: CONDUCT_NOTE,
    },
  },
  suspended: {
    slots: ['post', 'thread', 'section', 'note', 'until', 'conduct'],
    words: {
      subject: 'Your account is suspended until {until}',
      preheader: 'An admin suspended your account.',
      heading: 'Your account is suspended',
      paragraphs: [
        "An admin suspended your account until {until} because of the post below, which broke the code of conduct. Until then you can't sign in to post or play. Your characters stay where they are, and anything of theirs already in play carries on.",
        `When the date passes, you can sign in again with nothing else to do. To appeal, reply to this email and a person will read it.`,
      ],
      note: CONDUCT_NOTE,
    },
  },
  banned: {
    slots: ['post', 'thread', 'section', 'note', 'conduct'],
    words: {
      subject: 'Your account has been banned',
      preheader: 'An admin banned your account.',
      heading: 'Your account has been banned',
      paragraphs: [
        "An admin permanently banned your account because of the post below, which broke the code of conduct. You can't sign in.",
        'A ban stays until an admin lifts it. To appeal, reply to this email and a person will read it.',
      ],
      note: CONDUCT_NOTE,
    },
  },
  lifted: {
    slots: ['conduct'],
    words: {
      subject: 'The restriction on your account has been lifted',
      preheader: 'You can sign in again.',
      heading: 'You can sign in again',
      paragraphs: [
        'An admin lifted the restriction on your account. You can sign in and carry on.',
        "If this is a surprise, or you have questions, reply to this email and a person will read it.",
      ],
      note: CONDUCT_NOTE,
    },
  },
};

/** The rows the facts block shows, in order, each with the slot that fills it. */
const ROWS: readonly (readonly [slot: string, label: string])[] = [
  ['post', 'Post'],
  ['thread', 'Thread'],
  ['section', 'Rule'],
  ['note', "Admin's note"],
  ['until', 'Until'],
];

/** Fills `{slot}` in `words` from `values`; a slot the template lacks throws. */
function fill(words: string, slots: readonly string[], values: Readonly<Record<string, string>>, where: string): string {
  return words.replace(/\{(\w+)\}/g, (_m, name: string) => {
    if (!slots.includes(name)) throw new Error(`${where}: the slot {${name}} is not one this template has (${slots.join(', ') || 'none'})`);
    return values[name] ?? '';
  });
}

export function renderMail(template: ConductTemplate, facts: Readonly<Record<string, unknown>>, options: { readonly override?: ConductMailOverride } = {}): Mail {
  const t = TEMPLATES[template];
  if (t === undefined) throw new Error(`no mail template "${String(template)}"`);
  for (const key of Object.keys(facts)) if (!t.slots.includes(key)) throw new Error(`${template}: unknown slot "${key}" (the slots are ${t.slots.join(', ') || 'none'})`);
  const values: Record<string, string> = {};
  const val = (slot: string) => values[slot] ?? '';
  for (const slot of t.slots) {
    const v = facts[slot];
    if (v === undefined) throw new Error(`${template}: missing slot "${slot}"`);
    if (typeof v !== 'string') throw new Error(`${template}: slot "${slot}" is not text`);
    values[slot] = v;
  }
  const w = { ...t.words, ...Object.fromEntries(Object.entries(options.override?.[template] ?? {}).filter(([, v]) => v !== undefined)) } as Required<ConductWords>;
  const f = (s: string, where: string) => fill(s, t.slots, values, `${template} ${where}`);

  const blocks: Block[] = [{ type: 'heading', text: f(w.heading, 'heading') }];
  for (const [i, p] of w.paragraphs.entries()) blocks.push({ type: 'paragraph', text: f(p, `paragraph ${i + 1}`) });
  const rows = ROWS.filter(([slot]) => t.slots.includes(slot)).map(([slot, label]) => [label, val(slot) === '' ? 'None given.' : val(slot)] as const);
  if (rows.length > 0) blocks.push({ type: 'facts', rows });
  if (t.slots.includes('words')) blocks.push({ type: 'quote', label: 'Your words', words: val('words') });
  if (template === 'hiddenUntilEdited') blocks.push({ type: 'button', label: 'Edit your post', href: val('post') });
  if (w.note !== '') blocks.push({ type: 'note', text: f(w.note, 'note') });
  return { subject: f(w.subject, 'subject'), preheader: f(w.preheader, 'preheader'), blocks };
}
