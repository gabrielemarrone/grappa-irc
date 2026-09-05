import { describe, expect, it } from "vitest";
import { creditsRollPass } from "../lib/creditsRoll";

// #1920 — the suite's cursor: which pass of the credit roll is on screen.
//
// jsdom runs no animation, so this is exercised against a fake
// `getAnimations` exactly as `creditsRain.test.ts` exercises the phase reader.
// What that leaves unproven is the same thing it leaves unproven there — that
// a REAL `credits-roll` exposes `currentIteration` — and it is unproven for a
// good reason: it is a Web Animations API guarantee, not ours.
//
// What IS worth pinning here is the degradation. Every fallback below is a
// live case (before mount, reduced motion, jsdom), and each one must answer
// "first pass" rather than throw: an easter egg that crashes the audio
// scheduler because it could not read an animation is worse than one whose
// music does not change.

/** An element answering `getAnimations()` the way a running roll would. */
function fakeRoll(currentIteration: number | null): HTMLElement {
  return {
    getAnimations: () => [{ effect: { getComputedTiming: () => ({ currentIteration }) } }],
  } as unknown as HTMLElement;
}

describe("creditsRollPass (#1920)", () => {
  it("counts the completed cycles of the roll", () => {
    expect(creditsRollPass(fakeRoll(0))).toBe(0);
    expect(creditsRollPass(fakeRoll(1))).toBe(1);
    expect(creditsRollPass(fakeRoll(7))).toBe(7);
  });

  it("floors a partial iteration to the pass it is inside", () => {
    // `currentIteration` is an integer per spec, but `getComputedTiming` is
    // free to hand back a float on an effect with a non-integer iteration
    // count, and a fractional movement index would wrap to a different
    // movement halfway through a bar.
    expect(creditsRollPass(fakeRoll(2.99))).toBe(2);
  });

  it("stays on the first pass when there is no animation to read", () => {
    // Three real cases, one answer: before the roll mounts, under
    // `prefers-reduced-motion` (where the roll is a plain scrollable column
    // with no animation at all), and in jsdom.
    expect(creditsRollPass(undefined)).toBe(0);
    expect(creditsRollPass({ getAnimations: () => [] } as unknown as HTMLElement)).toBe(0);
    expect(creditsRollPass(document.createElement("div"))).toBe(0);
  });

  it("stays on the first pass rather than passing a non-number through", () => {
    // `currentIteration` is null before the animation starts playing. Handed
    // on unguarded it would reach the scheduler's modulo and come back NaN,
    // which indexes no movement at all — a silent soundtrack from a
    // millisecond of timing.
    expect(creditsRollPass(fakeRoll(null))).toBe(0);
    expect(creditsRollPass(fakeRoll(Number.POSITIVE_INFINITY))).toBe(0);
    expect(creditsRollPass(fakeRoll(Number.NaN))).toBe(0);
    expect(creditsRollPass(fakeRoll(-1))).toBe(0);
  });
});
