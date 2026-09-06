import type { MatrixRainLook } from "../MatrixRain";

// #1807 — what the credits modal's rain looks like, and WHEN it changes.
//
// #1773 shipped the effect at the Debug panel's settings, where the rain is
// dim on purpose because readouts have to stay legible through it. Behind the
// end titles nothing has to stay legible through it: the rain IS the picture,
// and at those settings it read as a faint texture rather than as rain
// (verified on a real iPhone against `4c9270c5`).
//
// The two looks below are the whole of this module's data; the rest is the
// one question the modal asks 15 times a second — "is the roll parked?".

/**
 * The steady look, while the titles are travelling.
 *
 * Against `4c9270c5`: the glyph goes 0.18 → 0.30 so it is visible at all; the
 * wash goes 0.10 → 0.06, which takes the trail from dying in seven frames
 * (0.9^7 of an alpha that started at 0.18) to a streak that is still a third
 * as bright twenty frames later; the head gets its own near-opaque light
 * amber, which is the single change that makes the effect read as rain rather
 * than as drifting dots; and the column advances 0.7 rows per frame instead
 * of one, which is vjt's 0.7x (revised up from 0.4x on #grappa at 01:57).
 *
 * The speed does NOT come from the frame budget — `MatrixRain` keeps its
 * ~15fps loop, because at ~6fps the columns visibly step.
 */
export const CREDITS_RAIN_LOOK: MatrixRainLook = {
  glyphAlpha: 0.3,
  fadeAlpha: 0.06,
  leader: "rgba(255, 232, 176, 0.95)",
  rowsPerFrame: 0.7,
};

/**
 * The interlude burst: once the titles have scrolled off the top, the roll
 * holds off-screen for a few seconds and the rain is all there is to look at.
 * Leaders go full white, the wash drops again so more of every column is lit
 * at once, and the fall speeds up past the 0.7x baseline (vjt, #grappa 01:55).
 *
 * ⚠️ "More columns lighting at once" was the third item vjt named, and it has
 * no referent in this implementation: every column already paints on every
 * frame — they differ only in where their head is, so there is no unlit
 * column to light. It is rendered here as more of each column being lit
 * (brighter glyph, longer streak) rather than as more columns, and that is a
 * substitution, not the same thing.
 *
 * #1929 reuses this look for the FIRST block's fade rather than introducing a
 * third one, and that is a deliberate reuse of the two-look model rather than
 * an interpolation between them: "the rain thickens" is satisfied by reaching
 * this look as the dissolve begins. A ramp would mean lerping four knobs
 * (one of them an rgba string) to render a four-second nuance, which is more
 * mechanism than the effect is worth — see DESIGN_NOTES.
 */
export const CREDITS_RAIN_BURST_LOOK: MatrixRainLook = {
  glyphAlpha: 0.45,
  fadeAlpha: 0.05,
  leader: "rgba(255, 255, 255, 1)",
  rowsPerFrame: 1,
};

/**
 * The look for RIGHT NOW, given the element carrying the `credits-roll`
 * animation and the one carrying `credits-block-fade`. Handed to `MatrixRain`
 * as its `look` prop, so it is called from inside the frame loop that already
 * exists.
 *
 * #1929 — TWO reasons to burst now, and they are the same reason: there is
 * nothing left on screen to compete with the rain. The interlude is that state
 * arrived at by the roll parking; the fade is it arrived at by the first block
 * dissolving. The rain thickens THROUGH the dissolve rather than after it,
 * which is what makes the block hand over to the prose instead of just
 * stopping.
 *
 * @param roll the `.credits-roll` element, or `undefined` before it mounts
 * @param block the `.credits-block` element, or `undefined` before it mounts
 *   and after the first pass has taken it away
 */
export function creditsRainLook(
  roll: HTMLElement | undefined,
  block: HTMLElement | undefined,
): MatrixRainLook {
  return rollIsParked(roll) || rollIsClear(roll) || blockIsFading(block)
    ? CREDITS_RAIN_BURST_LOOK
    : CREDITS_RAIN_LOOK;
}

/**
 * How wide the viewport's fade band is as a fraction of its height, read off
 * the `--credits-mask-fade` custom property the mask itself is built from.
 *
 * Cached per element: this is a `getComputedStyle` call, the look is asked for
 * ~15 times a second, and the value is a constant of the STYLESHEET rather
 * than of the layout — a rotation does not change a percentage.
 *
 * Falls back to `0` when the property is missing or is not a percentage, which
 * makes `rollIsClear` mean "has left the box entirely" — i.e. the behaviour
 * from before it existed, rather than a wrong burst.
 */
const maskFade = new WeakMap<HTMLElement, number>();

function maskFadeFraction(viewport: HTMLElement): number {
  const cached = maskFade.get(viewport);
  if (cached !== undefined) return cached;

  const raw = getComputedStyle(viewport).getPropertyValue("--credits-mask-fade").trim();
  const percent = /^([\d.]+)%$/.exec(raw);
  const parsed = percent === null ? Number.NaN : Number(percent[1]) / 100;
  const fraction = Number.isFinite(parsed) && parsed >= 0 && parsed < 1 ? parsed : 0;

  maskFade.set(viewport, fraction);
  return fraction;
}

/**
 * Have the titles left the READER's screen — i.e. is the roll's last line
 * already inside (or above) the mask's top fade band?
 *
 * A THIRD route to the state the other two report, and it exists because vjt
 * watched the real thing and timed the gap: "passa troppo tempo tra il para
 * disappearing up e la matrix rain intensifying".
 *
 * That gap is arithmetic rather than a mistiming. `rollIsParked` answers off
 * the animation's phase, and the animation is NOT finished when the text stops
 * being visible: the roll keeps travelling until its bottom edge clears the
 * top of the box, while the mask faded that same text to nothing a band's
 * height earlier. On a ~800px screen the band is ~96px and the roll covers
 * ~34px a second, so the picture is empty for about three seconds before the
 * phase agrees — and only then does the interlude's own 3.24s begin.
 *
 * Measured off the BOX rather than derived from the keyframes, because the
 * distance depends on the roll's own height, and that is whatever the current
 * prose set happens to be. Two `getBoundingClientRect` reads per drawn frame
 * at ~15fps, from inside a loop that is already painting a full-screen canvas.
 *
 * Not a second clock: it reads the state the roll is IN, it does not count
 * time alongside it. Pause the roll and this answer freezes with it.
 *
 * Degrades to "not clear" when there is no box to measure — jsdom, where every
 * rect is zero, and any state where the viewport has not been laid out.
 *
 * @param roll the `.credits-roll` element, or `undefined` before it mounts
 */
export function rollIsClear(roll: HTMLElement | undefined): boolean {
  if (roll === undefined) return false;

  const viewport = roll.parentElement;
  if (viewport == null) return false;

  const box = viewport.getBoundingClientRect();
  if (box.height <= 0) return false;

  return roll.getBoundingClientRect().bottom <= box.top + box.height * maskFadeFraction(viewport);
}

/**
 * Is the first block dissolving — i.e. has `credits-block-fade` reached the
 * stretch where its opacity is on the way down?
 *
 * Same posture as `rollIsParked`, deliberately: the phase is READ off the
 * animation that performs the fade, so the rain cannot surge at a different
 * moment than the block dissolves. Retime the dissolve in the stylesheet and
 * the surge moves with it, with nothing here to edit.
 *
 * Degrades to "not fading" for the same three real cases as its sibling, plus
 * a fourth of its own: after the first pass the block is gone from the DOM,
 * and `undefined` is then the honest answer rather than a missing element.
 */
export function blockIsFading(block: HTMLElement | undefined): boolean {
  if (block === undefined) return false;

  const effect = block.getAnimations?.()[0]?.effect ?? null;
  if (effect === null) return false;

  const progress = effect.getComputedTiming().progress;
  if (typeof progress !== "number") return false;

  const startsAt = fadeOffset(effect);
  return startsAt !== null && progress >= startsAt;
}

/**
 * The offset at which the block STARTS losing opacity, read off the fade's own
 * keyframes — the last stop that is still fully opaque.
 *
 * Read rather than declared, for the reason `parkOffset` is: a constant here
 * would be a second copy of a number living in `@keyframes
 * credits-block-fade`, and the two would drift the first time anyone retimed
 * the dissolve.
 *
 * `null` when there is no dissolve to be inside of — a fade whose first stop
 * is already transparent, or one that never stops being opaque.
 */
function fadeOffset(effect: AnimationEffect): number | null {
  const keyframed = effect as AnimationEffect & {
    readonly getKeyframes?: () => readonly ComputedKeyframe[];
  };
  const frames = keyframed.getKeyframes?.();
  if (frames === undefined) return null;

  let opaqueUntil: number | null = null;
  for (const frame of frames) {
    if (frame.opacity !== "1") break;
    opaqueUntil = frame.computedOffset;
  }
  return opaqueUntil !== null && opaqueUntil > 0 && opaqueUntil < 1 ? opaqueUntil : null;
}

/**
 * Is the roll parked off-screen — i.e. is this the interlude?
 *
 * ONE CLOCK. The interlude is a stretch of the CSS animation's own cycle (the
 * translate finishes early and the last keyframes hold), so the phase is read
 * off the animation instead of being counted alongside it. A `setTimeout`
 * would be a second clock that has to agree with the first, and it would
 * disagree exactly where it matters: in a backgrounded tab, rAF stops and
 * timers do not, so the burst would come back mid-roll.
 *
 * Degrades to "not parked" rather than throwing. `getAnimations` is absent in
 * jsdom, and absent FOR REAL under `prefers-reduced-motion`, where the roll
 * is a plain scrollable column with no animation at all — no phase to read,
 * and no rain running to burst anyway.
 */
export function rollIsParked(roll: HTMLElement | undefined): boolean {
  if (roll === undefined) return false;

  const effect = roll.getAnimations?.()[0]?.effect ?? null;
  if (effect === null) return false;

  const progress = effect.getComputedTiming().progress;
  if (typeof progress !== "number") return false;

  const parksAt = parkOffset(effect);
  return parksAt !== null && progress >= parksAt;
}

/**
 * The offset in the cycle at which the roll stops travelling, read off the
 * animation's OWN keyframes.
 *
 * Read rather than declared, so the stylesheet stays the single source of
 * truth for both ends of the interlude — a constant here would be a second
 * copy of a number that lives in `@keyframes credits-roll`, and the two would
 * drift the first time anyone retimed the roll.
 *
 * `null` when there is no interlude to be inside of: a roll whose FIRST
 * keyframe already carries the final transform is not rolling, and one that
 * only reaches it at the end has no hold.
 */
function parkOffset(effect: AnimationEffect): number | null {
  const keyframed = effect as AnimationEffect & {
    readonly getKeyframes?: () => readonly ComputedKeyframe[];
  };
  const frames = keyframed.getKeyframes?.();
  const last = frames?.at(-1);
  if (frames === undefined || last === undefined) return null;

  for (const frame of frames) {
    if (frame.transform !== last.transform) continue;
    const at = frame.computedOffset;
    return at > 0 && at < 1 ? at : null;
  }
  return null;
}
