import type { Character } from '../data/api.ts';

/** The tall avatar of a profile: the portrait, else the square, else the name's initial. Decoration: the name beside it says who. */
export function Avatar({ character }: { readonly character: Character }) {
  const src = character.avatarPortrait ?? character.avatarSquare;
  return (
    <span className="kb-profile-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" decoding="async" /> : <span className="kb-profile-none">{character.name.slice(0, 1)}</span>}
    </span>
  );
}
