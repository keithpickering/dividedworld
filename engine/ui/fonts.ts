/**
 * Font files an instance serves, put in the document's font set as FontFaces with `display: swap`,
 * so text shows in the fallback while a font loads. A face added this way is fetched under the
 * site's font-src, where an injected `<style>` of @font-face rules would be refused by its style-src
 * (web/headers.ts; e2e/csp.spec.ts holds it). The engine names no family: the instance gives each
 * file, the family it joins and, for a face a device may already have, the installed faces to try
 * first (`local`), so a device that has the family never downloads the file.
 *
 * A face is only fetched when text on the page needs it, so a face for a family a stack names after
 * one the device has (DejaVu Sans after Verdana) costs that device nothing. Each face is added once
 * per document, however often this is called; a document with no font set (a test's) is left alone.
 * A face whose file fails to load goes to `error` in the font set and its text keeps the rest of its
 * stack, so nothing throws.
 */

/** One font file, as the instance resolved it: the family it joins, its weight and style. */
export interface FontFile {
  readonly family: string;
  /** The URL the file is served at. */
  readonly file: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  /** Installed faces tried before the file, by full or PostScript name; a device that has one uses it. */
  readonly local?: readonly string[];
  /** The characters the file holds (CSS `unicode-range`); a character outside them falls through to the next family. */
  readonly unicodeRange?: string;
}

/** The faces put in each document, by file, weight and style, so a second call adds none. */
const installed = new WeakMap<object, Set<string>>();

export function installFonts(doc: Document, files: readonly FontFile[]): void {
  const Face = doc.defaultView?.FontFace;
  if (!doc.fonts || !Face) return;
  let done = installed.get(doc);
  if (!done) installed.set(doc, (done = new Set()));
  for (const f of files) {
    const face = `${f.file} ${f.weight} ${f.style}`;
    if (done.has(face)) continue;
    done.add(face);
    const source = [...(f.local ?? []).map((name) => `local(${JSON.stringify(name)})`), `url(${JSON.stringify(f.file)}) format("woff2")`].join(', ');
    const descriptors: FontFaceDescriptors = { weight: String(f.weight), style: f.style, display: 'swap' };
    if (f.unicodeRange) descriptors.unicodeRange = f.unicodeRange;
    doc.fonts.add(new Face(f.family, source, descriptors));
  }
}
