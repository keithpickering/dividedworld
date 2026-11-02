/**
 * The developer persona's mark beside its name: the instance's picture (`InstanceUi.avatars`, by the persona's key) or, where it gave none, the name's
 * first letter. Decoration: the name beside it says who, so it is hidden from a screen reader and carries no alt text.
 */
export function PersonaMark({ name, picture }: { readonly name: string; readonly picture: string | undefined }) {
  return (
    <span className="kb-updates-ava" aria-hidden="true">
      {picture !== undefined ? <img src={picture} alt="" /> : <span className="kb-updates-ava-none">{name.slice(0, 1)}</span>}
    </span>
  );
}
