// #1920 — which PASS of the credit roll is on screen right now.
//
// Sibling of `creditsRain.rollIsParked`, and here for the same reason: the
// `.credits-roll` CSS animation is the modal's ONE clock, so anything that has
// to change "when the titles come back round" reads the phase off that
// animation rather than counting a second time in JS. A `setInterval` at
// 34 s would be a second clock that drifts in exactly the case that matters —
// a backgrounded tab freezes rAF and the animation with it, while timers keep
// running, so the soundtrack would turn over while the roll stood still.
//
// Kept OUT of `creditsRain.ts` on purpose: that module is the rain's look, and
// this is the soundtrack's cursor. They happen to read the same element.

/**
 * How many times the roll has restarted since the modal opened — 0 during the
 * first pass, 1 once the titles have re-entered from the bottom, and so on.
 *
 * Degrades to 0 rather than throwing, and that degradation is a real case
 * rather than a defensive one: `getAnimations` is absent in jsdom, and absent
 * FOR REAL under `prefers-reduced-motion`, where the roll is a plain
 * scrollable column with no animation to have a pass of. A soundtrack that
 * stays on its first movement is the right answer there.
 *
 * @param roll the `.credits-roll` element, or `undefined` before it mounts
 */
export function creditsRollPass(roll: HTMLElement | undefined): number {
  if (roll === undefined) return 0;

  const effect = roll.getAnimations?.()[0]?.effect ?? null;
  if (effect === null) return 0;

  // `currentIteration` is the animation's own count of completed cycles, so
  // no duration arithmetic happens here and retiming the roll needs no edit.
  // It is `null` before the animation starts and can be Infinity-adjacent on
  // an effect with no iteration duration; both fall back to the first pass.
  const iteration = effect.getComputedTiming().currentIteration;
  if (typeof iteration !== "number" || !Number.isFinite(iteration)) return 0;

  return Math.max(0, Math.floor(iteration));
}
