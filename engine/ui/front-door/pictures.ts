/**
 * How the front door's staged pictures become addresses a post can draw. A post's picture must be an http(s) address (`safeImageSrc`), and a bundled
 * file's address is root-relative, so a staged picture that starts with a single `/` is made absolute against an origin: the page's own when the
 * thread is drawn, and `CHECK_ORIGIN` where there is no page (the instance's marks reading its post's images, `frontDoorProblems`). A mark over a
 * picture names it by the root-relative address the instance wrote, and the page makes that absolute the same way, so the mark finds its picture.
 */

/** The origin the build-time readers of a front-door post use, which no page has. */
export const CHECK_ORIGIN = 'https://front-door.test';

/** A root-relative address made absolute against `origin`; every other address as it was. */
export const absoluteSrc = (src: string, origin: string): string => (/^\/(?!\/)/u.test(src) ? new URL(src, origin).href : src);

/** A body's `[img]` pictures with a root-relative address made absolute against `origin`. */
export const absolutePictures = (text: string, origin: string): string => text.replace(/\[img\](\/(?!\/)[^[]*)\[\/img\]/giu, (_m, src: string) => `[img]${absoluteSrc(src, origin)}[/img]`);

/** An address made absolute against `CHECK_ORIGIN` as it was written: back to its root-relative form. */
export const writtenSrc = (src: string): string => (src.startsWith(`${CHECK_ORIGIN}/`) ? src.slice(CHECK_ORIGIN.length) : src);
