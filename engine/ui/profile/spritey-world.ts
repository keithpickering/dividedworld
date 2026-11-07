/**
 * The world the profile and record board stories share (`Boards/08 Profile`, `Boards/10 Record`): Spritey, a title and a signature of its own, a
 * place first of three in season 1, the Posts, spins and plays of its public record, and a reveal. Its days are the board's, Oct 18 to 29, dated in
 * the week before the backend's clock so a reader's "days ago" has turned to a date for a while. Not a story: a story file exports only stories.
 */
import type { World } from '../story.tsx';

const OCT = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);

export const spriteyWorld: World = (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const me = fake.seed.account('story-player', { seasoned: true });
  const other = fake.seed.account('story-other');
  const spritey = fake.seed.character(other, 'Spritey', cls, { at: OCT(1) });
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', cls, { at: OCT(1) });
  const gloomba = fake.seed.character(fake.seed.account('story-third'), 'Gloomba', cls, { at: OCT(1) });
  const general = instance.boards.find((b) => !b.system)!.slug;
  const first = fake.seed.thread(general, spritey, 'The long one', 'Where to begin.', { at: OCT(18) });
  fake.seed.post(first.thread, spritey, 'Post 168 of the long thread. Still going.', { at: OCT(19) });
  fake.seed.reveal(spritey, first.thread, { class: cls, at: OCT(20) });
  fake.seed.card(spritey, first.act, instance.cards[0]!.key, { at: OCT(22) });
  fake.seed.thread(general, spritey, 'who keeps splatting my posts', 'Again.', { at: OCT(27) });
  fake.seed.post(first.thread, spritey, 'Third time this week. I wrote four whole paragraphs about the new ink and it all went.', { at: OCT(29) });
  fake.seed.settle({ at: OCT(28), standings: { [spritey]: 650, [gloomba]: 320, [hooligan]: 140 }, wallet: { [me]: 240 } });
  /* A title and a signature are the owner's to set. */
  fake.signInAs(other);
  void fake.setProfile(spritey, 'Level editor guy', '[i]posting in pencil since 2003[/i]', instance.pipStyles[0]?.key ?? 'default');
  fake.signInAs(me);
};
