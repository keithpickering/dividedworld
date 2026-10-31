/**
 * The board match: whether a screen the app renders is the screen its board draws. A pure function
 * over two snapshots, with no Playwright in it, so e2e/board-match.test.ts can drive it red on a
 * plain object; e2e/board-snapshot.ts reads the snapshots out of a page, and e2e/boards.spec.ts
 * runs both.
 *
 * A manifest (e2e/boards/<NN>-<name>.ts) lists a board's landmarks by role and accessible name. A
 * snapshot says, for each landmark, whether it was found, where, and how its first text is set. The
 * comparison is what docs/plans/2026-10-30-glass-to-the-boards-plan.md section 2.3 specifies: a box
 * within 8px of the board's position and 4px of its size (a popover's parts measured from its own corner,
 * where the manifest says so), the same font family, size and weight,
 * the same opaque color, letter-spacing within half a pixel. It never compares the smoke's pixels,
 * numbers, or anything a manifest leaves out.
 *
 * A mismatch is always a finding, never a skip: a landmark the build lacks, a landmark the board
 * lacks (the manifest is wrong), a `buildName` that matches nothing in the build.
 */

/** How a landmark's box is compared: `full` (the default), x and y only, y and height only, width and height only, or not at all. */
export type BoxMode = 'full' | 'position' | 'height' | 'size' | 'none';

export interface Landmark {
  /** Names the landmark in a snapshot and a report; unique in its manifest. */
  readonly id: string;
  /** An ARIA role, as `getByRole` takes it, or `text` for a part with no role, found by its own words (`getByText`). */
  readonly role: string;
  /** The board's accessible name, matched whole and without case. */
  readonly name: string;
  /** The build's accessible name where a decision makes it differ from the board's. */
  readonly buildName?: string;
  /** The build's role where a decision makes it differ from the board's (the board draws a link where the build has a button). */
  readonly buildRole?: string;
  /** Another landmark's id: the search is made inside that one. */
  readonly within?: string;
  /**
   * Another landmark's id, earlier in the manifest: this one's x and y are compared as offsets from
   * that one's top-left on each side, for the parts of a popover whose own place follows a page the
   * board only draws (the React board's picker over its post). Width and height are compared as ever.
   */
  readonly origin?: string;
  /** Which of several matches (0 is the first). */
  readonly nth?: number;
  /** Which of the build's matches, where the build names a landmark the board leaves unnamed (`nth` otherwise). */
  readonly buildNth?: number;
  readonly box?: BoxMode;
  /** `false` for a landmark whose type is not the glass's to compare (an image). */
  readonly type?: boolean;
  /**
   * The build's font size in px where a decision moves it off the board's (the React picker's
   * quadrant labels, 24px by the owner's answer on #54, where the board draws 22px): the build is
   * held to it, and the rest of its type to the board's.
   */
  readonly buildSize?: number;
}

export interface BoardManifest {
  /** The board's id: its file name without `.html`, such as `01-main`. */
  readonly board: string;
  readonly size: { readonly width: number; readonly height: number };
  /** What renders the build side: the app at a fixture moment, or a story. */
  readonly build: { readonly moment: string } | { readonly story: string };
  /**
   * Controls pressed on the build's page, in order, before it is read: a board that draws a state
   * the player reaches by a press (the Phone board's hand, open) is reached the same way.
   */
  readonly press?: readonly Press[];
  readonly landmarks: readonly Landmark[];
  /**
   * Further build sides of the same board page, each compared against it on its own: a board that
   * draws two screens at once (the Cards board's hand sheet, a story, and its play form, the app)
   * has one build for each. A side has its own build, presses and landmarks; its ids stand alone.
   */
  readonly also?: readonly BoardSide[];
}

/** A control pressed on the build's page: found by role and whole name, the `nth` match of those (the first by default; -1 is the last). */
export interface Press {
  readonly role: string;
  readonly name: string;
  readonly nth?: number;
  /** Words typed into a text box in place of a press (the play form's message), to reach the state the board draws it in. */
  readonly fill?: string;
}

/** One further build side of a board (`BoardManifest.also`). */
export interface BoardSide {
  /** Names the side in the test's title and the report's folder. */
  readonly name: string;
  readonly build: BoardManifest['build'];
  readonly press?: readonly Press[];
  readonly landmarks: readonly Landmark[];
}

export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** How a landmark's first text is set, as the browser computes it (`color` as `rgb()` or `rgba()`, lengths in px). */
export interface TypeRead {
  readonly family: string;
  readonly size: number;
  readonly weight: number;
  readonly color: string;
  readonly letterSpacing: number;
}

export interface Shot { readonly id: string; readonly found: boolean; readonly box?: Box; readonly type?: TypeRead }
export interface Snapshot { readonly shots: readonly Shot[] }

export interface Mismatch {
  readonly landmark: string;
  readonly field: string;
  readonly board: string;
  readonly build: string;
  readonly message: string;
}

/** The tolerances, in px. */
export const POSITION_TOLERANCE = 8;
export const SIZE_TOLERANCE = 4;
export const SPACING_TOLERANCE = 0.5;

const mismatch = (landmark: string, field: string, board: string, build: string, note = ''): Mismatch => ({
  landmark, field, board, build,
  message: field === 'presence' ? `${landmark}: ${note}` : `${landmark}: ${field} is ${build} in the build, ${board} on the board${note ? ` (${note})` : ''}`,
});

/** `rgb(r, g, b)`, `rgba(r, g, b, a)`, `rgb(r g b / a)` (channels may be percents), a hex color or `transparent`, as channels 0-255 and alpha 0-1; null when unreadable. */
function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!fn) return null;
  const raw = fn[1]!.split(/[\s,/]+/).filter(Boolean);
  if (raw.length < 3 || raw.length > 4) return null;
  /* A percent is of 255 in a color channel and of 1 in the alpha. */
  const parts = raw.map((p, i) => (p.endsWith('%') ? (parseFloat(p) / 100) * (i < 3 ? 255 : 1) : parseFloat(p)));
  if (parts.some(Number.isNaN)) return null;
  return { r: Math.round(parts[0]!), g: Math.round(parts[1]!), b: Math.round(parts[2]!), a: parts[3] ?? 1 };
}

const firstFamily = (family: string) => family.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();

function compareBox(id: string, mode: BoxMode, board: Box, build: Box, origin?: string): Mismatch[] {
  if (mode === 'none') return [];
  const fields: { name: keyof Box; tolerance: number }[] = [];
  if (mode === 'full' || mode === 'position') fields.push({ name: 'x', tolerance: POSITION_TOLERANCE }, { name: 'y', tolerance: POSITION_TOLERANCE });
  if (mode === 'height') fields.push({ name: 'y', tolerance: POSITION_TOLERANCE });
  if (mode === 'full' || mode === 'size') fields.push({ name: 'width', tolerance: SIZE_TOLERANCE }, { name: 'height', tolerance: SIZE_TOLERANCE });
  if (mode === 'height') fields.push({ name: 'height', tolerance: SIZE_TOLERANCE });
  const measured = origin === undefined ? '' : `, measured from ${origin}`;
  return fields.filter((f) => Math.abs(board[f.name] - build[f.name]) > f.tolerance)
    .map((f) => mismatch(id, f.name, String(board[f.name]), String(build[f.name]), `more than ${f.tolerance}px apart${measured}`));
}

/** A box's place as an offset from another's top-left. */
const offsetFrom = (box: Box, origin: Box): Box => ({ ...box, x: box.x - origin.x, y: box.y - origin.y });

function compareType(id: string, board: TypeRead, build: TypeRead, decidedSize?: number): Mismatch[] {
  const out: Mismatch[] = [];
  if (firstFamily(board.family) !== firstFamily(build.family)) out.push(mismatch(id, 'font-family', board.family, build.family));
  if (decidedSize !== undefined) {
    if (build.size !== decidedSize) out.push({ ...mismatch(id, 'font-size', String(decidedSize), String(build.size)), message: `${id}: font-size is ${build.size} in the build, ${decidedSize} by decision` });
  } else if (board.size !== build.size) out.push(mismatch(id, 'font-size', String(board.size), String(build.size)));
  if (board.weight !== build.weight) out.push(mismatch(id, 'font-weight', String(board.weight), String(build.weight)));
  const a = parseColor(board.color);
  const b = parseColor(build.color);
  if (!a || !b) out.push(mismatch(id, 'color', board.color, build.color, 'a color that cannot be read'));
  else if (a.a !== 1 || b.a !== 1) out.push(mismatch(id, 'color', board.color, build.color, 'a translucent color is not an opaque match'));
  else if (a.r !== b.r || a.g !== b.g || a.b !== b.b) out.push(mismatch(id, 'color', board.color, build.color));
  if (Math.abs(board.letterSpacing - build.letterSpacing) > SPACING_TOLERANCE) {
    out.push(mismatch(id, 'letter-spacing', String(board.letterSpacing), String(build.letterSpacing), `more than ${SPACING_TOLERANCE}px apart`));
  }
  return out;
}

/** Everything in the build that differs from its board, by the manifest's landmarks, in the manifest's order. */
export function compareBoard(board: Snapshot, build: Snapshot, manifest: BoardManifest): Mismatch[] {
  const out: Mismatch[] = [];
  for (const l of manifest.landmarks) {
    const b = board.shots.find((s) => s.id === l.id);
    const u = build.shots.find((s) => s.id === l.id);
    if (!b?.found) {
      out.push(mismatch(l.id, 'presence', 'missing', u?.found ? 'found' : 'missing', `missing on the board: the manifest is wrong about ${l.role} "${l.name}"`));
      continue;
    }
    if (!u?.found) {
      const asked = l.buildName ?? l.name;
      out.push(mismatch(l.id, 'presence', 'found', 'missing', `missing from the build: no ${l.role} named "${asked}"`));
      continue;
    }
    if (l.origin !== undefined) {
      const ob = board.shots.find((s) => s.id === l.origin);
      const ou = build.shots.find((s) => s.id === l.origin);
      if (!manifest.landmarks.some((m) => m.id === l.origin)) {
        out.push(mismatch(l.id, 'origin', l.origin, l.origin, `measured from ${l.origin}, which is no landmark of the manifest`));
      } else if (!ob?.found || !ou?.found || !ob.box || !ou.box) {
        out.push(mismatch(l.id, 'origin', ob?.found ? 'found' : 'missing', ou?.found ? 'found' : 'missing', `measured from ${l.origin}, which is missing, so its place cannot be compared`));
      } else if (b.box && u.box) out.push(...compareBox(l.id, l.box ?? 'full', offsetFrom(b.box, ob.box), offsetFrom(u.box, ou.box), l.origin));
    } else if (b.box && u.box) out.push(...compareBox(l.id, l.box ?? 'full', b.box, u.box));
    if (l.type !== false) {
      if (b.type && u.type) out.push(...compareType(l.id, b.type, u.type, l.buildSize));
      else if (b.type || u.type) out.push(mismatch(l.id, 'font', b.type ? 'text' : 'no text', u.type ? 'text' : 'no text', 'one side has no text to read'));
    }
  }
  return out;
}

/**
 * Every build side of a board compared, the board's own first and then each of `also` in order, each
 * with its own manifest (its build, presses and landmarks; its ids stand alone) and the report folder
 * `<board>-<side>`. `compare` reads one side and returns its mismatches' words; a further side's are
 * led by its name, so a finding says which screen of the board it is about. A side is never skipped:
 * the list is the manifest's, whatever the first side found.
 */
export async function compareSides(
  manifest: BoardManifest,
  compare: (side: BoardManifest, folder: string, label: string | null) => Promise<string[]>,
): Promise<string[]> {
  const out = await compare(manifest, manifest.board, null);
  for (const side of manifest.also ?? []) {
    const found = await compare({ ...manifest, build: side.build, press: side.press, landmarks: side.landmarks, also: undefined }, `${manifest.board}-${side.name}`, side.name);
    out.push(...found.map((m) => `${side.name}: ${m}`));
  }
  return out;
}

/**
 * Which boards the spec runs, from the folder's file names, the boards that have a manifest and the
 * pending map (board id to the part that builds it). The list is the folder's, so a board cannot be
 * left out by forgetting it: a board with no manifest that is not pending is a problem, a pending
 * board that has a manifest is one (the map went stale), and so is a name in either list that is no
 * board in the folder.
 */
export function boardsToRun(
  folder: readonly string[],
  manifests: readonly string[],
  pending: Readonly<Record<string, string>>,
): { run: string[]; pending: string[]; problems: string[] } {
  const boards = folder.filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -'.html'.length)).sort();
  const has = new Set(manifests);
  const problems: string[] = [];
  const run: string[] = [];
  const waiting: string[] = [];
  for (const b of boards) {
    const part = pending[b];
    if (has.has(b)) {
      run.push(b);
      if (part !== undefined) problems.push(`${b} has a manifest and is still in PENDING (${part}): remove it from the map`);
    } else if (part !== undefined) waiting.push(b);
    else problems.push(`${b} has no manifest and is not in PENDING: write e2e/boards/${b}.ts, or name the part that builds it`);
  }
  for (const name of Object.keys(pending)) if (!boards.includes(name)) problems.push(`PENDING names ${name}, which is no board file in the folder`);
  for (const name of manifests) if (!boards.includes(name)) problems.push(`e2e/boards/${name}.ts is a manifest for no board file in the folder`);
  return { run, pending: waiting, problems };
}
