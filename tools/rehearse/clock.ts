// The Node side of the rehearsal's simulated clock. `simulateClock()` replaces `globalThis.Date` with a
// subclass whose `now()` and argument-less constructor return real time plus an offset; everything else about
// Date is the real one. Timers run on the monotonic clock and are not touched.
// Limit no patch can fix: a `Date` constructor captured into a variable before simulateClock() reads real time.
export type SimulatedClock = {
  setSimulated(ms: number): void;
  restore(): void;
};

export function simulateClock(): SimulatedClock {
  const RealDate = globalThis.Date;
  let offset = 0;
  // A plain function sharing RealDate.prototype, so every Date (made before this call, or by native code) is
  // `instanceof Date` and `new Date(5).constructor === Date`. Called without `new` it answers as Date() does.
  function SimulatedDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) return new (SimulatedDate as unknown as new () => Date)().toString();
    const made = args.length === 0 ? [RealDate.now() + offset] : args;
    return Reflect.construct(RealDate, made, new.target);
  }
  Object.setPrototypeOf(SimulatedDate, RealDate);
  Object.defineProperty(SimulatedDate, "prototype", { value: RealDate.prototype, writable: false });
  for (const key of Object.getOwnPropertyNames(RealDate)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    Object.defineProperty(SimulatedDate, key, Object.getOwnPropertyDescriptor(RealDate, key)!);
  }
  Object.defineProperty(SimulatedDate, "now", { value: () => RealDate.now() + offset, writable: true, configurable: true });
  Object.defineProperty(RealDate.prototype, "constructor", { value: SimulatedDate, writable: true, configurable: true });
  globalThis.Date = SimulatedDate as unknown as DateConstructor;
  return {
    setSimulated(ms) {
      offset = ms - RealDate.now();
    },
    restore() {
      Object.defineProperty(RealDate.prototype, "constructor", { value: RealDate, writable: true, configurable: true });
      globalThis.Date = RealDate;
    },
  };
}
