// The engine's one reading of cron: `matches`, `lastDue` and `nextDue`, for the five-field grammar
// engine/rules/instance.ts accepts (numbers, `*`, ranges, lists, steps; day of week 0 and 7 both Sunday), read in UTC
// as pg_cron reads it. Day of month and day of week follow cron's rule: when both are restricted (neither starts with
// `*`), either matching is enough. A malformed expression throws: the settings validator keeps one out of the database,
// so one here is a bug to see, not a job to skip. The job-health reading
// (engine/rules/jobs.ts) and the rehearsal's scheduler (tools/rehearse/schedule.ts) both use it; this file imports
// nothing.
// `parseCron` reads an expression once into a form the three functions take in place of the string, for a caller that
// asks about one schedule many times.
const FIELDS = [
  { name: 'minute', lo: 0, hi: 59 },
  { name: 'hour', lo: 0, hi: 23 },
  { name: 'day of month', lo: 1, hi: 31 },
  { name: 'month', lo: 1, hi: 12 },
  { name: 'day of week', lo: 0, hi: 7 },
] as const;

function fieldValues(text: string, lo: number, hi: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron ${name}: "${part}" is not a number, *, range or step`);
    const step = m[4] === undefined ? 1 : Number(m[4]);
    if (step < 1) throw new Error(`cron ${name}: step "${part}" must be at least 1`);
    let from = lo;
    let to = hi;
    if (m[1] !== '*') {
      from = Number(m[2]);
      to = m[3] === undefined ? (m[4] === undefined ? from : hi) : Number(m[3]);
    }
    if (from < lo || to > hi || from > to) throw new Error(`cron ${name}: "${part}" is outside ${lo}-${hi}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domFree: boolean;
  dowFree: boolean;
}

export function parseCron(expr: string): CronSchedule {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron "${expr}": expected five fields`);
  const [, , fDom, , fDow] = fields as [string, string, string, string, string];
  const values = fields.map((f, i) => fieldValues(f, FIELDS[i]!.lo, FIELDS[i]!.hi, FIELDS[i]!.name));
  const [minute, hour, dom, month, dowRaw] = values as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  return { minute, hour, dom, month, dow: new Set([...dowRaw].map((d) => d % 7)), domFree: fDom.startsWith('*'), dowFree: fDow.startsWith('*') };
}

const reading = (expr: string | CronSchedule): CronSchedule => (typeof expr === 'string' ? parseCron(expr) : expr);

function dayMatches(p: CronSchedule, day: Date): boolean {
  if (!p.month.has(day.getUTCMonth() + 1)) return false;
  const domOk = p.dom.has(day.getUTCDate());
  const dowOk = p.dow.has(day.getUTCDay());
  return p.domFree || p.dowFree ? domOk && dowOk : domOk || dowOk;
}

export function matches(expr: string | CronSchedule, at: Date): boolean {
  const p = reading(expr);
  return p.minute.has(at.getUTCMinutes()) && p.hour.has(at.getUTCHours()) && dayMatches(p, at);
}

const MINUTE = 60_000;
const DAY = 86_400_000;

// The latest minute <= `at` (seconds dropped) the expression matches, or null when none falls in the 366 days before
// `at`. It walks back by day and, inside a matching day, takes the latest matching hour and minute, so a daily or a
// monthly schedule costs a few hundred steps and never a minute-by-minute walk.
export function lastDue(expr: string | CronSchedule, at: Date): Date | null {
  const p = reading(expr);
  const hours = [...p.hour].sort((a, b) => b - a);
  const minutes = [...p.minute].sort((a, b) => b - a);
  const top = Math.floor(at.getTime() / MINUTE) * MINUTE;
  const startDay = Math.floor(top / DAY) * DAY;
  for (let back = 0; back <= 366; back++) {
    const dayStart = startDay - back * DAY;
    if (!dayMatches(p, new Date(dayStart))) continue;
    // The latest minute of the day this walk may take: the bound itself on the first day, the day's end after.
    const limit = back === 0 ? (top - dayStart) / MINUTE : 1439;
    for (const h of hours) {
      for (const m of minutes) {
        if (h * 60 + m <= limit) return new Date(dayStart + (h * 60 + m) * MINUTE);
      }
    }
  }
  return null;
}

// The first minute strictly after `after` (seconds dropped from `after` first) the expression matches, or null when none
// falls in the 366 days after it. The mirror of lastDue, so a stopped job's first missed run is found without walking
// minute by minute.
export function nextDue(expr: string | CronSchedule, after: Date): Date | null {
  const p = reading(expr);
  const hours = [...p.hour].sort((a, b) => a - b);
  const minutes = [...p.minute].sort((a, b) => a - b);
  const from = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
  const startDay = Math.floor(from / DAY) * DAY;
  for (let forward = 0; forward <= 366; forward++) {
    const dayStart = startDay + forward * DAY;
    if (!dayMatches(p, new Date(dayStart))) continue;
    const floor = forward === 0 ? (from - dayStart) / MINUTE : 0;
    for (const h of hours) {
      for (const m of minutes) {
        if (h * 60 + m >= floor) return new Date(dayStart + (h * 60 + m) * MINUTE);
      }
    }
  }
  return null;
}
