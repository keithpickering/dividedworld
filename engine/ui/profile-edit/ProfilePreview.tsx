/**
 * "What everyone will see" on Edit profile: the postbit as the board draws it beside a character's posts (engine/ui/postbit/Postbit.tsx), given
 * the form's own values, so it follows what is typed. It is drawn from what the form holds and never saved or sent: nothing about it reaches the
 * server until Save. The character's posts and standing come with the page's document (the postbit's own facts); a made-up post stands beside it so the
 * signature is drawn where it will be, under the post's words.
 */
import type { Character, Id, MyCharactersPage } from '../data/api.ts';
import { CalmRegion } from '../glass/Calm.tsx';
import { Postbit, Signature } from '../postbit/Postbit.tsx';
import { reveals, type Statement } from '../postbit/reveals.ts';

/**
 * What a postbit shows that the form does not hold: how many posts the character has, its season standing (hundredths), and the class its
 * player has made public, if any (a reveal or an announced Turn: what everyone sees under the name, and never more than that).
 */
export interface Facts extends Statement { readonly posts: number; readonly standing: number | null }

/** The facts of one character, from the document My characters loaded. */
export function factsOf(page: MyCharactersPage, id: Id): Facts {
  const said = reveals(page.reveals, page.turns).get(id) ?? { revealed: null, turnedAt: null };
  return { posts: page.counts[id]?.posts ?? 0, standing: page.standings[id] ?? null, ...said };
}

export function ProfilePreview({ character, title, signature, pipStyle, facts }: {
  /** The character as saved, with its name, avatar and the month it joined. */
  readonly character: Character;
  /** The form's values. */
  readonly title: string;
  readonly signature: string;
  readonly pipStyle: string;
  /** What the postbit shows beside them, from the page's document. */
  readonly facts: Facts;
}) {
  const shown: Character = { ...character, title, signature, pipStyle };
  return (
    <CalmRegion as="aside" className="kb-profile-preview" aria-labelledby="pe-preview-head">
      <h3 id="pe-preview-head" className="kb-profile-preview-head">What everyone will see</h3>
      <div className="kb-profile-preview-post">
        <div className="kb-profile-preview-side">
          <Postbit person={{ character: shown, posts: facts.posts, standing: facts.standing, revealed: facts.revealed, turnedAt: facts.turnedAt }} layout="side" link={false} />
        </div>
        <div className="kb-profile-preview-body">
          <p>A post by {character.name} reads here.</p>
          <Signature text={signature} />
        </div>
      </div>
      <p className="kb-profile-preview-note">The preview follows what you type. Nothing changes on the board until you save.</p>
    </CalmRegion>
  );
}
