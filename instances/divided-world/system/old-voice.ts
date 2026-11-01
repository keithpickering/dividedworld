/**
 * The old voice's prompt frame for a board's description (design, section 6; the staff design,
 * section 13). The old voice is a base model from 2019 to 2021 on raw completion: it does not follow
 * instructions, it continues a document. So the document is a 2003 board index, a few boards with
 * their descriptions in the cheerfully unhinged voice of an old forum, and it ends exactly where
 * the new board's description begins, `Description:`, so what the model writes next is that
 * description. It stops at the end of the line, as the next board's row would begin.
 *
 * The name and the premise come from a model and a player's words, so each is collapsed to a
 * single line before it is put in the document: a newline in either could end the frame early or
 * add a row of its own.
 */
import type { OldVoiceFrame } from '../../../engine/rules/types.ts';

const FRAME = `Welcome to the Message Boards - Board Index
Last visit: Tuesday, 11:42 PM  |  Members online: 3  |  Guests: 41  |  Mood: unclear

Board: Mario Fan Games Showcase
Subject: show off your fangame (screenshots required, no "my game is not done yet" threads please!!)
Description: ur game is sooo cool!!! posting here makes the moderators smile. do NOT post your hack here if it is just the mushroom kingdom with a hat on. the hat thread is in Off Topic.

Board: Off Topic Lounge
Subject: anything that does not fit anywhere else
Description: it's a free country except for the rules. we have snacks. sometimes the snacks are posts. read the sticky before you ask about the sticky.

Board: Help Desk (ask here!)
Subject: help with games, computers and life
Description: if your question is in the FAQ we will find you. we are very nice about it. we are very nice about everything. please don't post your password, we know it already.

Board: Spam Graveyard
Subject: dead threads and what became of them
Description: RIP all of you. if you were looking for the thread you wrote last week it has moved on and so should you. candles are in the sticky.
`;

/** Collapses everything that is not one visible line into single spaces, and trims it to `most` characters. */
function oneLine(text: string, most: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, most);
}

export function oldVoice(input: { readonly name: string; readonly premise: string }): OldVoiceFrame {
  const name = oneLine(input.name, 120);
  const premise = oneLine(input.premise, 300);
  return {
    prompt: `${FRAME}\nBoard: ${name}\nSubject: ${premise}\nDescription:`,
    stop: ['\n', 'Board:'],
  };
}
