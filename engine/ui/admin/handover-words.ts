/**
 * A handover's to-do in plain words (the staff roster design, section 11): the sentence the admin queue shows, and the facts the Write an
 * update form is opened with. The glass speaking plainly, out of character, and never a model: every word here is a fact the database holds
 * about the handover, put in a sentence. The announcement itself is the admin's to write.
 */
import type { HandoverTodo } from '../data/api.ts';

/** An office as a sentence names it. An office the log has no word for is left out rather than guessed. */
export function officeWords(office: string | null): string | null {
  switch (office) {
    case 'mod': return 'a Moderator';
    case 'member': return 'a member';
    case 'benched': return 'benched';
    case 'waiting': return 'waiting to debut';
    case 'boss': return 'the Boss';
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

/** The handover's plain facts, one line each: the new Boss and what it was, the outgoing Boss and what it is now, and how the seat was filled. */
export function todoFacts(t: HandoverTodo): string[] {
  const was = officeWords(t.bossWas);
  const now = officeWords(t.outgoingOffice);
  const lines = [`Season ${t.season}'s Boss: ${t.bossName}${was === null ? '' : ` (was ${was})`}.`];
  if (t.outgoing !== null && t.outgoingName !== null) lines.push(now === null ? `${t.outgoingName} left the Boss's seat.` : `${t.outgoingName} is now ${now}.`);
  lines.push(t.how === 'nomination' ? 'The Boss was chosen by nomination.' : 'The Boss was chosen by the roster\'s rotation.');
  return lines;
}

/** What the form opens with: the title, and the facts as the words, a blank line between them, for the admin to replace. */
export function todoDraft(t: HandoverTodo): { readonly title: string; readonly words: string } {
  return { title: todoTitle(t), words: todoFacts(t).join('\n\n') };
}
