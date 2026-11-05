/**
 * Font files an instance serves, as faces in the document's font set: a face the site's policy
 * allows under font-src, where an injected style is refused (web/headers.ts). A board font names the
 * installed faces to try before its file, so a device that has the family never downloads it.
 */
import { describe, expect, it } from 'vitest';
import { installFonts, type FontFile } from './fonts.ts';

class FakeFace {
  constructor(readonly family: string, readonly source: string, readonly descriptors: FontFaceDescriptors) {}
}
const fakeDoc = () => ({ fonts: new Set<FakeFace>(), defaultView: { FontFace: FakeFace } });
const install = (doc: ReturnType<typeof fakeDoc>, files: readonly FontFile[]) => installFonts(doc as unknown as Document, files);

const DEJAVU: FontFile = {
  family: 'DejaVu Sans', file: '/assets/DejaVuSans.woff2', weight: 400, style: 'normal',
  local: ['DejaVu Sans', 'DejaVuSans'], unicodeRange: 'U+0000-00FF',
};

describe('installFonts', () => {
  it('tries each installed face it names before the file, in order', () => {
    const doc = fakeDoc();
    install(doc, [DEJAVU]);
    expect([...doc.fonts].map((f) => f.source)).toEqual(['local("DejaVu Sans"), local("DejaVuSans"), url("/assets/DejaVuSans.woff2") format("woff2")']);
  });

  it('serves only the characters its file holds, so a character outside them falls through to the next family', () => {
    const doc = fakeDoc();
    install(doc, [DEJAVU]);
    expect([...doc.fonts].map((f) => f.descriptors)).toEqual([{ weight: '400', style: 'normal', display: 'swap', unicodeRange: 'U+0000-00FF' }]);
  });

  it('names only the file where it names no installed face and no range', () => {
    const doc = fakeDoc();
    install(doc, [{ family: 'Anton', file: '/assets/Anton.woff2', weight: 400, style: 'normal' }]);
    expect([...doc.fonts].map((f) => [f.source, f.descriptors])).toEqual([['url("/assets/Anton.woff2") format("woff2")', { weight: '400', style: 'normal', display: 'swap' }]]);
  });

  it('adds each face once, however often it is called', () => {
    const doc = fakeDoc();
    install(doc, [DEJAVU]);
    install(doc, [DEJAVU]);
    expect(doc.fonts.size).toBe(1);
  });

  it('does nothing where the document has no font set (a test document)', () => {
    expect(() => installFonts(document, [DEJAVU])).not.toThrow();
  });
});
