/**
 * What the e2e files' fake model needs to read a request the way the real adapter writes it, and to answer the meeting's calls
 * (MEETING_PARTS in engine/system/meeting.ts). The Anthropic adapter sends `system` and the first message as blocks of text when the
 * request has a `cachePrefix`, so a fake that reads either as a string reads "[object Object]"; `textOf` reads both forms. The meeting is
 * answered one part at a time: `partOf` says which part a request asks for (the last message ends with that part's `ask`), and
 * `partAnswer` keeps of the whole answer only the fields that part owns, as the real model's structured output would.
 */
import { MEETING_PARTS, type MeetingPartKey } from '../../../engine/system/meeting.ts';

type Content = string | readonly { type?: string; text?: string }[] | undefined;
type Body = { system?: Content; messages?: { role?: string; content?: Content }[] };

/** The text of a string or of a list of text blocks. */
export const textOf = (content: Content): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => b.text ?? '').join('') : '';

export const systemOf = (body: Body): string => textOf(body.system);
export const firstMessageOf = (body: Body): string => textOf(body.messages?.[0]?.content);
const lastMessageOf = (body: Body): string => textOf(body.messages?.[(body.messages?.length ?? 1) - 1]?.content);

/** Which meeting part a request asks for, or null when it is not a meeting call. */
export function partOf(body: Body): MeetingPartKey | null {
  const last = lastMessageOf(body).trimEnd();
  return MEETING_PARTS.find((p) => last.endsWith(p.ask))?.key ?? null;
}

/** The fields of a whole meeting answer that one part answers. */
export function partAnswer(answer: Record<string, unknown>, key: MeetingPartKey): Record<string, unknown> {
  const fields: readonly string[] = MEETING_PARTS.find((p) => p.key === key)!.fields;
  return Object.fromEntries(Object.entries(answer).filter(([k]) => fields.includes(k)));
}
