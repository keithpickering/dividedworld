/**
 * A handover's to-do in plain words (the staff roster design, section 11): the sentence the admin queue shows, and the facts the Write an
 * update form is opened with. The glass speaking plainly, out of character, and never a model: every word here is a fact the database holds
 * about the handover, put in a sentence. The announcement itself is the admin's to write.
 */
import { lowerFirst } from '../copy-words.ts';
import type { HandoverTodo } from '../data/api.ts';
import { handoffFactsText } from '../../system/meeting.ts';

/**
 * An office as a sentence names it. An office the log has no word for is left out rather than guessed. The top office is the instance's
 * own word (`UiCopy.roleWord`), read mid-sentence: the engine names no instance's role.
 */
export function officeWords(office: string | null, role: string): string | null {
  switch (office) {
    case 'mod': return 'a Moderator';
    case 'member': return 'a member';
    case 'benched': return 'benched';
    case 'waiting': return 'waiting to debut';
    case 'boss': return lowerFirst(role);
    default: return null;
  }
}

/** "Season 4 opens with Comptroller." */
export function todoSentence(t: HandoverTodo): string {
  return `Season ${t.season} opens with ${t.bossName}.`;
}

/** The title the form opens with: the sentence, without its full stop. */
export function todoTitle(t: HandoverTodo): string {
  return `Season ${t.season} opens with ${t.bossName}`;
}

/** The handover's plain facts, one line each: the new holder of the role (`role` is `UiCopy.roleWord`) and what it was, the outgoing one and what it is now, and how the seat was filled. */
export function todoFacts(t: HandoverTodo, role: string): string[] {
  const was = officeWords(t.bossWas, role);
  const now = officeWords(t.outgoingOffice, role);
  const lines = [`Season ${t.season}: ${role} is ${t.bossName}${was === null ? '' : ` (was ${was})`}.`];
  if (t.outgoing !== null && t.outgoingName !== null) lines.push(now === null ? `${t.outgoingName} left ${lowerFirst(role)}'s seat.` : `${t.outgoingName} is now ${now}.`);
  lines.push(t.how === 'nomination' ? `${role} was chosen by nomination.` : `${role} was chosen by the roster's rotation.`);
  return lines;
}

/** What the form opens with: the title, and the facts as the words, a blank line between them, for the admin to replace. */
export function todoDraft(t: HandoverTodo, role: string): { readonly title: string; readonly words: string } {
  return { title: todoTitle(t), words: todoFacts(t, role).join('\n\n') };
}

/**
 * The outgoing Boss's handoff as an admin reads it (0337): who it was written by, that it is out of character and no player's, its note or that it left none, and the facts the code counted for its
 * season. The note is the Boss's own words, kept apart from the glass's sentences; the facts are the code's and are true whatever the note says.
 */
export function todoHandoff(t: HandoverTodo): { readonly lead: string; readonly note: string | null; readonly none: string; readonly facts: readonly string[] } {
  const by = t.outgoingName ?? 'The outgoing Boss';
  return {
    lead: `${by}'s handoff note, written out of character for the next Boss and for you. Players never see it.`,
    note: t.note,
    none: `${by} left no handoff note; its last meeting did not write one.`,
    facts: handoffFactsText(t.facts),
  };
}
