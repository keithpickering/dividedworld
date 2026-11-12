import type { Character } from '../data/api.ts';
import { Outfit, slotShape } from '../gear/Outfit.tsx';

/** The tall avatar of a profile: the portrait at the shape it was cut, wearing its outfit, else the square, else the name's initial. Decoration: the name beside it says who. */
export function Avatar({ character }: { readonly character: Character }) {
  const src = character.avatarPortrait ?? character.avatarSquare;
  const portrait = character.avatarPortrait !== null;
  const tallness = portrait ? character.portraitTallness : null;
  return (
    <span className="kb-profile-avatar" data-kb-slot={portrait ? 'portrait' : undefined} data-kb-shaped={tallness === null ? undefined : ''} aria-hidden="true" style={slotShape(tallness)}>
      {src ? <img src={src} alt="" decoding="async" /> : <span className="kb-profile-none">{character.name.slice(0, 1)}</span>}
      {portrait && <Outfit pieces={character.outfit} on="portrait" />}
    </span>
  );
}
