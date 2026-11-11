// The Node side of the rehearsal's simulated clock: Date moves by an offset, nothing else changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateClock } from "./clock.ts";

test("after setSimulated(t), Date.now() and new Date() read t", () => {
  const clock = simulateClock();
  try {
    const t = Date.UTC(2027, 2, 3, 17, 30, 0);
    clock.setSimulated(t);
    assert.ok(Math.abs(Date.now() - t) < 50);
    assert.ok(Math.abs(new Date().getTime() - t) < 50);
  } finally {
    clock.restore();
  }
});

test("everything else about Date is unchanged", async () => {
  const clock = simulateClock();
  try {
    clock.setSimulated(Date.UTC(2027, 0, 1));
    assert.equal(new Date(0).getTime(), 0);
    assert.equal(Date.parse("2020-01-01T00:00:00Z"), 1577836800000);
    assert.ok(new Date() instanceof Date);
    assert.equal(new Date(2020, 0, 1).getFullYear(), 2020);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  } finally {
    clock.restore();
  }
});

test("restore puts the real Date back", () => {
  const real = globalThis.Date;
  const clock = simulateClock();
  clock.setSimulated(Date.UTC(2030, 0, 1));
  clock.restore();
  assert.equal(globalThis.Date, real);
});
