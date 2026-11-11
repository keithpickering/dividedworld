// A cron matcher for the five-field grammar engine/rules/instance.ts accepts (numbers, `*`, ranges, lists, steps; day of
// week 0 and 7 both Sunday), read in UTC as pg_cron reads it. Day of month and day of week follow cron's rule: when both
// are restricted (neither starts with `*`), either matching is enough. A malformed expression throws: the settings
// validator keeps one out of the database, so one here is a bug to see, not a job to skip.
const FIELDS = [
  { name: "minute", lo: 0, hi: 59 },
  { name: "hour", lo: 0, hi: 23 },
  { name: "day of month", lo: 1, hi: 31 },
  { name: "month", lo: 1, hi: 12 },
  { name: "day of week", lo: 0, hi: 7 },
] as const;

function fieldValues(text: string, lo: number, hi: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron ${name}: "${part}" is not a number, *, range or step`);
    const step = m[4] === undefined ? 1 : Number(m[4]);
    if (step < 1) throw new Error(`cron ${name}: step "${part}" must be at least 1`);
    let from = lo;
    let to = hi;
    if (m[1] !== "*") {
      from = Number(m[2]);
      to = m[3] === undefined ? (m[4] === undefined ? from : hi) : Number(m[3]);
    }
    if (from < lo || to > hi || from > to) throw new Error(`cron ${name}: "${part}" is outside ${lo}-${hi}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function matches(expr: string, at: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron "${expr}": expected five fields`);
  const [, , fDom, , fDow] = fields as [string, string, string, string, string];
  const [minute, hour, dom, month, dowRaw] = fields.map((f, i) => fieldValues(f, FIELDS[i]!.lo, FIELDS[i]!.hi, FIELDS[i]!.name)) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  const dow = new Set([...dowRaw].map((d) => d % 7));
  if (!minute.has(at.getUTCMinutes()) || !hour.has(at.getUTCHours()) || !month.has(at.getUTCMonth() + 1)) return false;
  const domOk = dom.has(at.getUTCDate());
  const dowOk = dow.has(at.getUTCDay());
  const domFree = fDom.startsWith("*");
  const dowFree = fDow.startsWith("*");
  return domFree || dowFree ? domOk && dowOk : domOk || dowOk;
}
