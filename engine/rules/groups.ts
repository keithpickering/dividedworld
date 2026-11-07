/**
 * Member groups: the look of each group, the ladder a character climbs and the groups a move confers.
 *
 * The ladder is ordered lowest first: the default rung is first, the staff rung last, and a character
 * is in the highest rung whose condition holds (`earnedGroup`). `CONDITION_KINDS` is the one list SQL's
 * `group_now` has a case for; a kind outside it is a problem here, and a raise there.
 */

/** How a group looks wherever it is shown: a stable key, a name, a #rrggbb color and an optional stripe. */
export interface GroupLook { readonly key: string; readonly name: string; readonly color: string; readonly stripe?: boolean }
/** What a character must hold to be in a rung. */
export type Condition = { readonly kind: 'default' } | { readonly kind: 'posts'; readonly atLeast: number } | { readonly kind: 'seasons'; readonly atLeast: number } | { readonly kind: 'staff' };
/** A group earned by climbing: its look and the condition that puts a character in it. */
export type Rung = GroupLook & { readonly when: Condition };
/** A group a move confers, as a punishment or a favor, rather than one earned. */
export type Conferred = GroupLook & { readonly tone: 'punishment' | 'favor' };
/** An instance's groups: the ladder (lowest first) and the groups moves confer. */
export interface GroupsContent { readonly ladder: readonly Rung[]; readonly conferred: readonly Conferred[] }
/** The condition kinds; the one list SQL's `group_now` has a case for. */
export const CONDITION_KINDS = ['default', 'posts', 'seasons', 'staff'] as const;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Problems with an instance's groups, each a sentence; none when whole. */
export function groupsProblems(content: GroupsContent): string[] {
  const out: string[] = [];
  const { ladder, conferred } = content;
  const kindOf = (r: Rung): unknown => (r.when as Condition | undefined)?.kind;
  const defaults = ladder.filter((r) => kindOf(r) === 'default').length;
  if (defaults !== 1) out.push(`the ladder has ${defaults} default rungs; exactly one is the default`);
  else if (kindOf(ladder[0]!) !== 'default') out.push('the default rung is not first; the ladder is lowest first, and the default is the lowest');
  const staff = ladder.filter((r) => kindOf(r) === 'staff').length;
  if (staff !== 1) out.push(`the ladder has ${staff} staff rungs; exactly one is the staff rung`);
  else if (kindOf(ladder[ladder.length - 1]!) !== 'staff') out.push('the staff rung is not last; the ladder is lowest first, and staff is the highest');
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const g of [...ladder, ...conferred]) (seen.has(g.key) ? twice : seen).add(g.key);
  for (const k of twice) out.push(`group key "${k}" is used twice across the ladder and the conferred groups`);
  for (const g of [...ladder, ...conferred]) {
    if (typeof g.key !== 'string' || g.key === '') out.push(`a group has an empty key (named ${JSON.stringify(g.name)})`);
    if (!COLOR.test(g.color)) out.push(`group "${g.key}" has color ${JSON.stringify(g.color)}; a color is #rrggbb`);
    if (typeof g.name !== 'string' || g.name.length < 1 || g.name.length > 32) out.push(`group "${g.key}" has a name of ${typeof g.name === 'string' ? g.name.length : 0} characters; a name is 1 to 32 characters`);
  }
  for (const c of conferred) {
    if (c.tone !== 'punishment' && c.tone !== 'favor') out.push(`conferred group "${c.key}" has tone ${JSON.stringify(c.tone)}; a tone is punishment or favor`);
  }
  for (const r of ladder) {
    if (r.when === undefined || r.when === null) out.push(`rung "${r.key}" has no condition`);
    else if (!(CONDITION_KINDS as readonly string[]).includes(r.when.kind)) out.push(`rung "${r.key}" has condition kind ${JSON.stringify(r.when.kind)}; the kinds are ${CONDITION_KINDS.join(', ')}`);
    else if ((r.when.kind === 'posts' || r.when.kind === 'seasons') && !(Number.isSafeInteger(r.when.atLeast) && r.when.atLeast > 0)) {
      out.push(`rung "${r.key}" needs atLeast ${JSON.stringify(r.when.atLeast)}; atLeast is a positive whole number`);
    }
  }
  return out;
}

/** The key of the highest rung (ladder is lowest first) whose condition the facts meet. */
export function earnedGroup(ladder: readonly Rung[], facts: { readonly posts: number; readonly seasons: number; readonly staff: boolean }): string {
  const holds = (rung: Rung): boolean => {
    const w = rung.when as Condition | undefined;
    switch (w?.kind) {
      case 'default': return true;
      case 'posts': return facts.posts >= w.atLeast;
      case 'seasons': return facts.seasons >= w.atLeast;
      case 'staff': return facts.staff;
      default: throw new Error(`rung "${rung.key}" has condition kind ${JSON.stringify((w as { kind?: unknown } | undefined)?.kind)}, which earnedGroup has no case for`);
    }
  };
  for (let i = ladder.length - 1; i >= 0; i--) if (holds(ladder[i]!)) return ladder[i]!.key;
  throw new Error('no rung holds; the ladder has no default rung');
}
