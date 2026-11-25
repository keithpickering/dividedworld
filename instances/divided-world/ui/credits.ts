/**
 * The credits /license lists (`InstanceUi.licensing.credits`; docs/plans/2026-11-25-licensing-plan.md, Task 5), built from the manifests
 * tools/check-licenses.mjs reads, so the page cannot say what the manifests do not: the rows of `licenses.json` that are not simply the
 * instance's own work, the sounds, the card, back and pack art that carries other terms, Hot Debate's fire and each Jimmy Wails plate.
 * A row whose terms are the layer's, by the layer's maker, with no note, is the instance's own and needs no credit.
 */
import type { LicenseCredit } from '../../../engine/ui/types.ts';
import licenses from '../licenses.json' with { type: 'json' };
import sounds from './sounds/sounds.json' with { type: 'json' };
import backArt from './card-back/art.json' with { type: 'json' };
import boosterArt from './packs/booster/art.json' with { type: 'json' };
import starterArt from './packs/starter/art.json' with { type: 'json' };
import { HOT_DEBATE_CREDIT } from './hot-debate-credit.ts';
import { PLATES } from './jimmy-wails/plates.ts';

const OWN = 'Divided World';
type Terms = 'layer' | { readonly name: string; readonly url: string };
interface Row { readonly files: readonly string[]; readonly maker: string; readonly terms: Terms; readonly work?: string; readonly source?: string; readonly note?: string }
interface Art { readonly credit: string; readonly license: string }

const fromRows = (rows: readonly Row[]): LicenseCredit[] => {
  const out = new Map<string, LicenseCredit>();
  for (const r of rows) {
    if (r.terms === 'layer' && r.maker === OWN && r.note === undefined) continue;
    const own = r.terms === 'layer';
    const work = r.work ?? r.files[0] ?? '';
    /* A work declared in more than one place (a font in the board's folder and the mail's) is one credit. */
    out.set(`${work}|${r.maker}`, {
      work, maker: r.maker,
      terms: own ? 'The terms of Divided World, above' : (r.terms as { name: string }).name,
      ...(own ? {} : { termsUrl: (r.terms as { url: string }).url }),
      ...(r.source === undefined ? {} : { source: r.source }),
      ...(r.note === undefined ? {} : { note: r.note }),
    });
  }
  return [...out.values()];
};

/** The art.json files that share a maker and terms, as one credit. Only terms that name a URL are credited; art offered without other terms is the instance's own. */
const ART = import.meta.glob<Art>('./cards/*/art.json', { eager: true, import: 'default' });
const artFiles: readonly Art[] = [...Object.values(ART), backArt, boosterArt, starterArt];
const fromArt = (): LicenseCredit[] => {
  const groups = new Map<string, LicenseCredit>();
  for (const a of artFiles) {
    const m = /^(.*?):\s*(https?:\/\/\S+)$/.exec(a.license);
    if (!m) continue;
    groups.set(`${a.credit}|${a.license}`, { work: 'Card art: every card\'s picture and mark, the card back, the pack art', maker: a.credit, terms: m[1] as string, termsUrl: m[2] as string });
  }
  return [...groups.values()];
};

const soundCredit = (): LicenseCredit[] => {
  const s = sounds as readonly { readonly source: string; readonly license: string; readonly maker: string }[];
  const first = s[0];
  if (first === undefined) return [];
  return [{ work: 'Sound effects', maker: first.maker, terms: `${first.source}: ${first.license.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')}` }];
};

const fromPlates = (): LicenseCredit[] => {
  const out = new Map<string, LicenseCredit>();
  for (const p of PLATES) out.set(p.credit.source, { work: `Jimmy Wales photograph (${p.key})`, maker: p.credit.author, terms: p.credit.license, termsUrl: p.credit.licenseUrl, source: p.credit.source, note: 'Cropped and faded for the banner.' });
  return [...out.values()];
};

export const credits: readonly LicenseCredit[] = Object.freeze([
  ...fromRows(licenses as readonly Row[]),
  ...soundCredit(),
  ...fromArt(),
  { work: HOT_DEBATE_CREDIT.work, maker: HOT_DEBATE_CREDIT.author, terms: HOT_DEBATE_CREDIT.license, termsUrl: HOT_DEBATE_CREDIT.licenseUrl, source: HOT_DEBATE_CREDIT.source },
  ...fromPlates(),
]);
