import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { captions } from '../engine/ui/audio/captions.ts';
import { cleanup, configure } from '@testing-library/react';

/* A find under a loaded parallel run can take longer than the default second. */
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  /* The page's one caption store outlives a test; whatever a test said or held does not. */
  captions.reset();
});

/**
 * The real clock, shifted: `KAYFA_TEST_SHIFT_DAYS=400 npx vitest run` runs every test as though it were that many days from now (issue #244).
 * No test's result may depend on the calendar date it runs on, because every screen and rule a test drives reads one clock, the backend's
 * (`api.now()`), which a test can set. A screen that still compares a time from the backend with the real `Date` passes today and fails on
 * the day the two meet; this finds it before that day does. Only `Date` moves: timers stay real and the shifted clock keeps running, so a wait still takes as long as it did.
 * Unset (or 0), nothing here does anything.
 */
const SHIFT_MS = Number(process.env['KAYFA_TEST_SHIFT_DAYS'] ?? 0) * 86_400_000;
if (SHIFT_MS !== 0) {
  const RealDate = Date;
  /* The shifted `Date` keeps running: a clock read now is the real one plus the shift, and a test's own fake timers (vi.useFakeTimers) install over it and restore it. */
  class ShiftedDate extends RealDate {
    constructor(...args: [] | [string | number | Date] | ConstructorParameters<typeof Date>) {
      if (args.length === 0) super(RealDate.now() + SHIFT_MS);
      else super(...(args as [number]));
    }
    static override now(): number { return RealDate.now() + SHIFT_MS; }
  }
  globalThis.Date = ShiftedDate as unknown as DateConstructor;
}
