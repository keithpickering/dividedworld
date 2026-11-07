export interface GroupLook { readonly key: string; readonly name: string; readonly color: string; readonly stripe?: boolean }
export type Condition = { readonly kind: 'default' } | { readonly kind: 'posts'; readonly atLeast: number } | { readonly kind: 'seasons'; readonly atLeast: number } | { readonly kind: 'staff' };
export type Rung = GroupLook & { readonly when: Condition };
export type Conferred = GroupLook & { readonly tone: 'punishment' | 'favor' };
export interface GroupsContent { readonly ladder: readonly Rung[]; readonly conferred: readonly Conferred[] }
export const CONDITION_KINDS = ['default', 'posts', 'seasons', 'staff'] as const;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Problems with an instance's groups, each a sentence; none when whole. */
export function groupsProblems(content: GroupsContent): string[] {
  const out: string[] = [];
  const { ladder, conferred } = content;
  const defaults = ladder.filter((r) => r.when.kind === 'default').length;
  if (defaults !== 1) out.push(`the ladder has ${defaults} default rungs; exactly one is the default`);
  else if (ladder[0]!.when.kind !== 'default') out.push('the default rung is not first; the ladder is lowest first, and the default is the lowest');
  const staff = ladder.filter((r) => r.when.kind === 'staff').length;
  if (staff !== 1) out.push(`the ladder has ${staff} staff rungs; exactly one is the staff rung`);
  else if (ladder[ladder.length - 1]!.when.kind !== 'staff') out.push('the staff rung is not last; the ladder is lowest first, and staff is the highest');
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const g of [...ladder, ...conferred]) (seen.has(g.key) ? twice : seen).add(g.key);
  for (const k of twice) out.push(`group key "${k}" is used twice across the ladder and the conferred groups`);
  for (const g of [...ladder, ...conferred]) {
    if (!COLOR.test(g.color)) out.push(`group "${g.key}" has color ${JSON.stringify(g.color)}; a color is #rrggbb`);
    if (typeof g.name !== 'string' || g.name.length < 1 || g.name.length > 32) out.push(`group "${g.key}" has a name of ${typeof g.name === 'string' ? g.name.length : 0} characters; a name is 1 to 32 characters`);
  }
  for (const r of ladder) {
    if (!(CONDITION_KINDS as readonly string[]).includes(r.when.kind)) out.push(`rung "${r.key}" has condition kind ${JSON.stringify(r.when.kind)}; the kinds are ${CONDITION_KINDS.join(', ')}`);
    else if ((r.when.kind === 'posts' || r.when.kind === 'seasons') && !(Number.isSafeInteger(r.when.atLeast) && r.when.atLeast > 0)) {
      out.push(`rung "${r.key}" needs atLeast ${JSON.stringify(r.when.atLeast)}; atLeast is a positive whole number`);
    }
  }
  return out;
}

/** The key of the highest rung (ladder is lowest first) whose condition the facts meet. */
export function earnedGroup(ladder: readonly Rung[], facts: { readonly posts: number; readonly seasons: number; readonly staff: boolean }): string {
  const holds = (w: Condition): boolean =>
    w.kind === 'default' ? true : w.kind === 'posts' ? facts.posts >= w.atLeast : w.kind === 'seasons' ? facts.seasons >= w.atLeast : facts.staff;
  for (let i = ladder.length - 1; i >= 0; i--) if (holds(ladder[i]!.when)) return ladder[i]!.key;
  throw new Error('no rung holds; the ladder has no default rung');
}
