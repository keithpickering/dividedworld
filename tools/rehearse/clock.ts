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
  // A class cannot be called without `new`, and the real Date can (it returns the time as a string), so the
  // class is wrapped in a Proxy whose `apply` answers as Date() does, from the simulated time.
  globalThis.Date = new Proxy(SimulatedDate, {
    apply: () => new SimulatedDate().toString(),
  }) as unknown as DateConstructor;
  return {
    setSimulated(ms) {
      offset = ms - RealDate.now();
    },
    restore() {
      globalThis.Date = RealDate;
    },
  };
}
