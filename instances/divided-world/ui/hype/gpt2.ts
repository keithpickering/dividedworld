/**
 * The GPT-2 text of the commentary video (docs/plans/2026-11-21-commentary-video-revision-design.md, section 6): real output of the You Were Saying?
 * card, read from the owner's test instance. `gpt2-tail.txt` holds a `#` header line (which says where it is from and names the post it
 * continued), then the tail exactly as the card made it, its leading space and blank lines kept. The stage's post is that post, word for
 * word, so the post and what it ran on with are the true pair.
 */
import file from './gpt2-tail.txt?raw';

/** The tail as the card made it: everything after the header line. */
export const GPT2_TAIL: string = file.slice(file.indexOf('\n') + 1);

/** The post the tail continued in the instance, from the header line. */
export const GPT2_POST: string = (() => {
  const post = /The post it continues was "(.*)"\.\s*$/u.exec(file.slice(0, file.indexOf('\n')))?.[1];
  if (!post) throw new Error('gpt2-tail.txt\'s header line no longer names the post the tail continued: `The post it continues was "…".`');
  return post;
})();
