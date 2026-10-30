/**
 * The rendered glass measurement's judgment (the web plan's glass amendment to Task 12; the glass
 * plan, section 6): what e2e/glass-text.spec.ts holds every text node on a glass page to, as pure
 * functions over plain data, so e2e/glass-text.test.ts drives each poison red without a browser and
 * the spec hands the same functions the facts it gathers in the page (e2e/glass-text-page.ts).
 *
 * The design's section 4 (docs/plans/2026-10-29-two-worlds-design.md) is the rule; the numbers are
 * the guard's (tools/check-glass-contrast.mjs), which writes each surface's ceilings from its own
 * recipe to e2e/glass-ceilings.json. A text node, one line of it at a time, is held to:
 *
 * - **Size.** Its face, at its computed size, inks at least 18px from ascender to descender, as the
 *   canvas measures it in the loaded face (the design's XAG 101 figure at 1080p); on the Phone
 *   board's layout, at least 16px of computed size (the design's phone floor, which the guard reads
 *   as a size and not as ink).
 * - **Opaque type.** Its color, times every opacity above it, has no alpha under 1.
 * - **A glass text color.** Its color is one of the active key's text tokens, a class's large text,
 *   or an ink; any other has no ceiling and fails by name.
 * - **Large, or where the worst is under the ceiling.** Text that inks 36px or more (the design:
 *   Anton at 37px, Barlow Condensed at 40px) in a token tagged `large` may stand on the full
 *   smoke, under that token's large ceiling. Everything else stands where the worst pixel its
 *   surface can put under it is under its token's body ceiling (or waiting, for a token that has
 *   no body tag): inside its calm's interior (the backing inset by its feather, where the backing
 *   is at its full opacity), on a panel at least as solid as the calm there, or on a recipe whose
 *   full worst (the ceilings file's `worst`, and on the phone its `narrowWorst` too) is under that
 *   ceiling. That last is the owner's answer on #53 (the web plan's Task 12 and the glass plan's
 *   section 6, amended 2026-10-30): the Turn board draws its words on the turn recipe's smoke with
 *   no calm, and that recipe is dim enough for its tokens. On a
 *   `calmAll` surface every node needs a calm (or such a panel), large or not. A class's large text has a ceiling only
 *   on a surface the engine's `classLargeText` says draws it (apply.ts; the guard writes `classes`
 *   only there), and needs a calm where that says `calmed`. It is read by its color at any size,
 *   as the engine's list reads it (the React picker's quadrant labels are a class's large text at
 *   22px of Anton).
 * - **Ink** (a token tagged `ink`, or a class's ink) stands on an opaque fill, and is not held to a
 *   ceiling over the smoke: the guard holds it to 4.5:1 on its fill.
 * - **The brightest pixel.** With all text made transparent, the brightest pixel under the line's
 *   box is under its color's ceiling for the surface.
 * - **High contrast.** Under the `high` key every line stands on solid ground: with the text made
 *   transparent, taking the smoke away changes no pixel under it by more than a level.
 *
 * "A panel at least as solid as the calm" is how this reads the plan's "an opaque panel": the guard
 * holds body text to 4.5:1 on the calmed worst, the smoke thinned by the calm's opacity, so a panel
 * of the ground's family at that opacity or more leaves the text a pixel no brighter. A panel only
 * counts between the text and the element whose smoke it stands on (the gatherer's job), since a
 * panel under the smoke is not under the text.
 */

export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type Rgba = readonly [number, number, number, number];

/** A layer under the text that is not the smoke: a panel's background, at the opacity it is drawn. */
export interface Backing { readonly box: Box; readonly opacity: number }

/** A calm: its backing as drawn, its feather, and `box`, the backing inset by the feather (its interior). */
export interface Calm extends Backing { readonly backing: Box; readonly feather: number }

/** One line of one text node on a glass surface, as the gatherer read it in the page. */
export interface TextFact {
  /** The words and where they are, for a message. */
  readonly name: string;
  /** The `GlassSurface` whose smoke the line stands on. */
  readonly surface: string;
  /** The line's visible box, in the screenshot's pixels. */
  readonly box: Box;
  /** Its color, with every opacity above it folded into the alpha. */
  readonly color: Rgba;
  readonly family: string;
  /** Its computed size in px, times its zoom. */
  readonly size: number;
  /** What its face inks at that size, ascender to descender, measured by the canvas. */
  readonly ink: number;
  /** Its nearest calm, or none. */
  readonly calm: Calm | null;
  /** The calm's opacity where the line is (the surface's recipe's or the theme's). */
  readonly calmOpacity: number;
  /** The panels between the line and its smoke's element, each with its box. */
  readonly panels: readonly Backing[];
  /** The brightest pixel's luminance under the box, with all text transparent. */
  readonly brightest: number;
  /** The most the smoke changes any channel under the box, with all text transparent (pixelStats): 0 is solid ground. */
  readonly smoke: number;
}

type CeilingTag = 'body' | 'large' | 'waiting';

/** One surface's block of e2e/glass-ceilings.json. */
export interface SurfaceCeilings {
  readonly recipe: string;
  readonly calmAll: boolean;
  readonly worst: number;
  readonly calmedWorst: number;
  readonly narrowWorst?: number;
  readonly narrowCalmedWorst?: number;
  readonly tokens: Readonly<Record<string, Partial<Record<CeilingTag, number>>>>;
  readonly classLarge?: 'full' | 'calmed';
  readonly classes?: Readonly<Record<string, { readonly large: number }>>;
}

export type CeilingsFile = Readonly<Record<string, { readonly surfaces: Readonly<Record<string, SurfaceCeilings>> }>>;

/** What the measurement reads of a GlassTheme (glass.json): its keys and its classes' colors. */
export interface GlassColors {
  readonly keys: Readonly<Record<string, Readonly<Record<string, { readonly value: string; readonly tags?: readonly string[] }>>>>;
  readonly classes: Readonly<Record<string, { readonly fill: string; readonly ink: string; readonly large: string }>>;
}

/** What a color is on the glass: a text token (its tags), a class's large text, or an ink. */
export type ColorRole =
  | { readonly kind: 'token'; readonly name: string; readonly tags: readonly CeilingTag[] }
  | { readonly kind: 'class'; readonly name: string }
  | { readonly kind: 'ink'; readonly name: string };

/** A key's text colors, by `r,g,b`; a color two roles share (a token and a class) has both. */
export interface Palette { readonly key: string; readonly roles: ReadonlyMap<string, readonly ColorRole[]> }

/** The design's floors and the large-text line, in px. */
export const INK_FLOOR = 18;
export const PHONE_FLOOR = 16;
export const LARGE_INK = 36;
/** A box may run past its container by this much: subpixel layout, not a defect. */
const SLACK = 0.5;

/** A color string's channels: `#rgb`, `#rrggbb`, `rgb()`, `rgba()` and `color(srgb …)` (what a color-mix computes to). */
export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (fn) return [+fn[1]!, +fn[2]!, +fn[3]!, alphaOf(fn[4])];
  const srgb = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (srgb) return [+srgb[1]! * 255, +srgb[2]! * 255, +srgb[3]! * 255, alphaOf(srgb[4])];
  return null;
}

function alphaOf(a: string | undefined): number {
  if (a === undefined) return 1;
  return a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
}

const keyOf = (c: Rgba | readonly number[]) => c.slice(0, 3).map((n) => Math.round(n)).join(',');

/** A key's text colors: each token by its tags, each class's large text and ink. */
export function paletteOf(glass: GlassColors, key: string): Palette {
  const roles = new Map<string, ColorRole[]>();
  const add = (value: string, role: ColorRole) => {
    const c = parseColor(value);
    if (!c) return;
    const k = keyOf(c);
    roles.set(k, [...(roles.get(k) ?? []), role]);
  };
  for (const [name, token] of Object.entries(glass.keys[key] ?? {})) {
    const tags = token.tags ?? [];
    if (tags.includes('ink')) add(token.value, { kind: 'ink', name });
    const text = tags.filter((t): t is CeilingTag => t === 'body' || t === 'large' || t === 'waiting');
    if (text.length) add(token.value, { kind: 'token', name, tags: text });
  }
  for (const [name, look] of Object.entries(glass.classes)) {
    add(look.large, { kind: 'class', name });
    add(look.ink, { kind: 'ink', name: `class ${name}'s ink` });
  }
  return { key, roles };
}

/** `inner` lies inside `outer`, give or take half a pixel. */
export function within(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x - SLACK && inner.y >= outer.y - SLACK
    && inner.x + inner.width <= outer.x + outer.width + SLACK && inner.y + inner.height <= outer.y + outer.height + SLACK;
}

/** How far `inner` runs past `outer` on its worst side, in px. */
function overrun(inner: Box, outer: Box): number {
  return Math.max(outer.x - inner.x, outer.y - inner.y, inner.x + inner.width - (outer.x + outer.width), inner.y + inner.height - (outer.y + outer.height));
}

/** WCAG 2.x relative luminance of 0-255 channels. */
export function luminance(r: number, g: number, b: number): number {
  const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Under `box`, in an RGBA buffer `width` pixels wide: the brightest pixel's luminance, and `smoke`,
 * the most any channel of any pixel changes against `bare`, the same window drawn with the smoke
 * taken away (0 with no `bare`). A glow or a gradient is in both and is no smoke; solid ground
 * under high contrast is a line the smoke changes nothing under. The pixels read are those whose
 * centers lie in the box; a box that holds no pixel center is read at its nearest pixel.
 */
export function pixelStats(data: ArrayLike<number>, width: number, height: number, box: Box, bare?: ArrayLike<number>): { brightest: number; smoke: number } {
  let x0 = Math.max(0, Math.ceil(box.x - 0.5));
  let y0 = Math.max(0, Math.ceil(box.y - 0.5));
  let x1 = Math.min(width, Math.ceil(box.x + box.width - 0.5));
  let y1 = Math.min(height, Math.ceil(box.y + box.height - 0.5));
  if (x1 <= x0) { x0 = Math.min(width - 1, Math.max(0, Math.round(box.x))); x1 = x0 + 1; }
  if (y1 <= y0) { y0 = Math.min(height - 1, Math.max(0, Math.round(box.y))); y1 = y0 + 1; }
  let brightest = 0;
  let smoke = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      brightest = Math.max(brightest, luminance(data[i]!, data[i + 1]!, data[i + 2]!));
      if (bare) for (let c = 0; c < 3; c++) smoke = Math.max(smoke, Math.abs(data[i + c]! - bare[i + c]!));
    }
  }
  return { brightest, smoke };
}

export interface JudgeContext {
  /** The surface's block of the ceilings file; none where the surface has no recipe. */
  readonly ceilings: SurfaceCeilings | undefined;
  /** The active key's colors. */
  readonly palette: Palette;
  /** On the Phone board's layout. */
  readonly phone: boolean;
  /** Under the high-contrast key. */
  readonly high: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const colorText = (c: Rgba) => (c[3] < 1 ? `rgba(${c.slice(0, 3).map(Math.round).join(', ')}, ${round1(c[3] * 100) / 100})` : `rgb(${c.slice(0, 3).map(Math.round).join(', ')})`);

/**
 * Every way one line fails the glass's rules for text, as whole sentences naming the line, its
 * surface and the number it missed; [] is clean.
 */
export function judge(fact: TextFact, ctx: JudgeContext): string[] {
  const at = `${fact.name} (surface ${fact.surface})`;
  const out: string[] = [];
  if (ctx.phone) {
    if (fact.size < PHONE_FLOOR - 0.01) out.push(`${at}: is ${round1(fact.size)}px of ${fact.family}, under the phone's floor of ${PHONE_FLOOR}px`);
  } else if (fact.ink < INK_FLOOR - 0.01) {
    out.push(`${at}: inks ${round1(fact.ink)}px at ${round1(fact.size)}px of ${fact.family}, under the floor of ${INK_FLOOR}px of ink`);
  }
  if (fact.color[3] < 1) out.push(`${at}: its color ${colorText(fact.color)} is translucent; glass type is opaque`);
  if (ctx.high) {
    if (fact.smoke > 1) out.push(`${at}: under high contrast the smoke shows through under it (it changes a channel by ${fact.smoke} levels), not solid ground`);
    return out;
  }
  const s = ctx.ceilings;
  if (!s) return [...out, `${at}: surface ${fact.surface} has no ceilings in e2e/glass-ceilings.json`];
  const roles = ctx.palette.roles.get(keyOf(fact.color)) ?? [];
  if (roles.length === 0) return [...out, `${at}: its color ${colorText([fact.color[0], fact.color[1], fact.color[2], 1])} is not one of the glass's text colors in the ${ctx.palette.key} key`];
  /* A color two roles share passes as either; the first role's faults are the ones told. */
  const readings = roles.map((role) => reading(fact, role, s, at, ctx.phone));
  const clean = readings.find((r) => r.length === 0);
  return clean ? out : [...out, ...readings[0]!];
}

/** A recipe dim enough to stand on bare: its full worst, and the ceiling the line is read at there. */
interface Dim { readonly worst: number; readonly ceiling: number; readonly as: string; readonly where: string }

/**
 * Whether the line stands where the worst pixel its surface can put under it is under its
 * ceiling: in its calm's interior, on a panel as solid as the calm, or, where `dim` is given, on a
 * recipe whose full worst is under the ceiling (the owner's answer on #53); the fault if not.
 */
function grounded(fact: TextFact, at: string, why: string, dim?: Dim): string | null {
  if (fact.calm && within(fact.box, fact.calm.box)) return null;
  if (fact.panels.some((p) => p.opacity >= fact.calmOpacity - 1e-6 && within(fact.box, p.box))) return null;
  if (dim && dim.worst < dim.ceiling) return null;
  const bright = dim ? `, and its recipe's full worst, ${dim.worst}, is not under the ceiling ${dim.ceiling} for ${dim.as} ${dim.where}` : '';
  if (fact.calm) {
    return `${at}: lies outside its calm's interior (its backing inset by its ${round1(fact.calm.feather)}px feather) by ${round1(overrun(fact.box, fact.calm.box))}px${bright}; ${why}`;
  }
  return `${at}: stands in no calm and on no panel as solid as the calm (${fact.calmOpacity})${bright}; ${why}`;
}

function reading(fact: TextFact, role: ColorRole, s: SurfaceCeilings, at: string, phone: boolean): string[] {
  const large = fact.ink >= LARGE_INK;
  const where = `on surface ${fact.surface} (recipe ${s.recipe})`;
  const calmAllWhy = `surface ${fact.surface} (recipe ${s.recipe}) is calmAll: every text node on it stands in a calm, large or not`;
  /* The most the surface's smoke can put under a line: on the phone, its narrow layers' too. */
  const worst = phone && s.narrowWorst !== undefined ? Math.max(s.worst, s.narrowWorst) : s.worst;
  if (role.kind === 'ink') {
    return fact.panels.some((p) => p.opacity >= 1 && within(fact.box, p.box)) ? [] : [`${at}: is ink, and stands on no opaque fill`];
  }
  let ceiling: number | undefined;
  let as: string;
  const faults: string[] = [];
  if (role.kind === 'class') {
    const own = s.classes?.[role.name]?.large;
    if (own === undefined || !s.classLarge) {
      return [`${at}: is class ${role.name}'s large text, and surface ${fact.surface} draws no class's large text (classLargeText says none), so it has no ceiling there`];
    }
    if (s.calmAll || s.classLarge === 'calmed') {
      const f = grounded(fact, at, s.calmAll ? calmAllWhy : `surface ${fact.surface} draws a class's large text in a calm (classLargeText says calmed)`);
      if (f) faults.push(f);
    }
    ceiling = own;
    as = `class ${role.name}'s large text`;
  } else {
    const onSmoke = large && role.tags.includes('large') && !s.calmAll;
    const tag: CeilingTag = onSmoke ? 'large' : role.tags.includes('body') ? 'body' : role.tags.includes('waiting') ? 'waiting' : 'large';
    ceiling = s.tokens[role.name]?.[tag];
    as = `${role.name} as ${tag} text`;
    if (ceiling === undefined) return [`${at}: ${role.name} has no ${tag} ceiling ${where}`];
    if (s.calmAll) {
      const f = grounded(fact, at, calmAllWhy);
      if (f) faults.push(f);
    } else if (!onSmoke) {
      const why = large
        ? `${role.name} is not a large token, so it stands in a calm at any size`
        : `text that inks under ${LARGE_INK}px (this inks ${round1(fact.ink)}px) stands in a calm ${where}`;
      const f = grounded(fact, at, why, { worst, ceiling, as, where });
      if (f) faults.push(f);
    }
  }
  if (!(fact.brightest < ceiling)) {
    faults.push(`${at}: its brightest pixel, luminance ${fact.brightest.toFixed(4)}, is not under the ceiling ${ceiling} for ${as} ${where}`);
  }
  return faults;
}

/** Faults a screen shows that wait on a question to the owner: which, by a pattern, and the question. */
export interface Awaiting { readonly fault: RegExp; readonly question: string }

/**
 * A screen's faults with those that wait on the owner set aside (CLAUDE.md: "A rule that fights
 * the product is asked about, not obeyed into a worse product"): `left` is every other fault,
 * which fails as before, and `stale` names each waiting entry no fault matches any longer, which
 * fails too, so an entry cannot outlive what it waits on.
 */
export function setAside(found: readonly string[], waits: readonly Awaiting[]): { left: string[]; stale: string[] } {
  return {
    left: found.filter((f) => !waits.some((w) => w.fault.test(f))),
    stale: waits.filter((w) => !found.some((f) => w.fault.test(f))).map((w) => `nothing waits on "${w.question}" here any more (${w.fault}); take its entry out`),
  };
}
