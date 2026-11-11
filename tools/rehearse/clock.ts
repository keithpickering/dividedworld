// The Node side of the rehearsal's simulated clock. `simulateClock()` replaces `globalThis.Date` with a
// subclass whose `now()` and argument-less constructor return real time plus an offset; everything else about
// Date is the real one. Timers run on the monotonic clock and are not touched.
export type SimulatedClock = {
  setSimulated(ms: number): void;
  restore(): void;
};

export function simulateClock(): SimulatedClock {
  const RealDate = globalThis.Date;
  let offset = 0;
  class SimulatedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [number]));
    }
    static override now(): number {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = SimulatedDate as unknown as DateConstructor;
  return {
    setSimulated(ms) {
      offset = ms - RealDate.now();
    },
    restore() {
      globalThis.Date = RealDate;
    },
  };
}
