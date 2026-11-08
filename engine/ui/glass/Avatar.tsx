import './avatar.css';

/**
 * A character's picture, or the first letter of its name where it has none. It is decoration beside a name read in words, so it is
 * `aria-hidden` and its picture has no alt: a reader hears the name, never the face. The letter is the name's first code point, so a
 * name that starts with an emoji or an astral letter is not split. avatar.css draws it; its size and border are the caller's class.
 */
export function Avatar({ src, name, className }: { readonly src: string | null; readonly name: string; readonly className?: string }) {
  return (
    <span className={className ? `kb-avatar ${className}` : 'kb-avatar'} aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span className="kb-avatar-none">{[...name][0]}</span>}
    </span>
  );
}
