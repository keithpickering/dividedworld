/**
 * The rule that names the screen functions, in one place, so the screen functions' guard (0016-screen-reads.ts) and the cold-read budget
 * (0028-cold-read-budget.ts) read one list and not two that drift. A screen function is a function in `public` named `boot`, ending `_page`
 * (but not in NOT_SCREEN_FUNCTIONS), or one of the search reads. Unnumbered, so tools/test-sql.mjs (which runs only `NNNN-*.ts`) does not
 * run it as a test, and importing it registers no test in the file that does.
 */
/** Runs one SQL text, in one session, and returns psql's unaligned output. */
export type Query = (text: string) => string;

export const lit = (xs: readonly string[]) => `array[${xs.map((x) => `'${x.replaceAll("'", "''")}'`).join(', ')}]::text[]`;

/**
 * Functions that end in `_page` and are not screen functions: `standings_page` (0030) is an older security definer plpgsql function the
 * standings screen already calls, named before this convention. The plan did not account for it; it leaves this list when it is rewritten
 * as a screen function or renamed. Nothing else belongs here.
 */
export const NOT_SCREEN_FUNCTIONS = ['standings_page'];

/** The search reads (0117) are screen functions without the `_page` name: one call, plpgsql with a fixed generic plan, an invoker, stable, reading what a screen may. */
export const SEARCH_READS = ['search_posts', 'search_threads', 'search_suggest'];

/** The rule as a SQL predicate over a `pg_proc` row's name. */
export const screenPredicate = (name: string): string =>
  `(${name} = 'boot' or ${name} like '%\\_page' or ${name} = any (${lit(SEARCH_READS)})) and ${name} <> all (${lit(NOT_SCREEN_FUNCTIONS)})`;

/** The names of every screen function in `public`, sorted, over the session `db` runs in. */
export function screenNames(db: Query): string[] {
  return db(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and ${screenPredicate('p.proname')} order by 1`).split(/\r?\n/).filter(Boolean);
}
