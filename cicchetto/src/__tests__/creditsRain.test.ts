import { describe, expect, it } from "vitest";
import { ADM_RAIN_LOOK } from "../AdminDebugTab";
import {
  blockIsFading,
  CREDITS_RAIN_BURST_LOOK,
  CREDITS_RAIN_LOOK,
  creditsRainLook,
  rollIsParked,
} from "../lib/creditsRain";
import type { MatrixRainLook } from "../MatrixRain";
import { mediaGatedBlocks, ruleBody, themeCss } from "./helpers/themeCss";

// #1807 — the credits rain reads as rain, and the burst rides the roll's own
// clock.
//
// Two subjects, and they are one subject: the LOOKS are only correct relative
// to what the Debug panel still runs (the issue's "0.7x the current speed"
// names that surface's speed), and the interlude only exists because the
// stylesheet parks the roll before its cycle ends. So the numbers are checked
// against the other surface's constant and against the stylesheet, never
// against a copy of themselves.
//
// What is NOT provable here: jsdom runs no animation, so the phase reader is
// exercised against a fake `getAnimations`. That the REAL CSS animation
// exposes the offsets this depends on is the e2e's job
// (issue1807-credits-rain-reads-as-rain.spec.ts) — and that the result looks
// like rain to a human is nobody's job but a human's, on a real phone.

type FakeStop = { readonly computedOffset: number; readonly transform: string };

/**
 * An element that answers `getAnimations()` the way a browser running
 * `credits-roll` would. Only that one method is reached, so the cast is the
 * whole of the fake.
 */
function fakeRoll(progress: number | null, stops: readonly FakeStop[]): HTMLElement {
  return {
    getAnimations: () => [
      {
        effect: {
          getComputedTiming: () => ({ progress }),
          getKeyframes: () => stops,
        },
      },
    ],
  } as unknown as HTMLElement;
}

const TRAVELLING = "translateY(100%)";
const PARKED = "translateY(-100%)";
const PARKS_AT_082: readonly FakeStop[] = [
  { computedOffset: 0, transform: TRAVELLING },
  { computedOffset: 0.82, transform: PARKED },
  { computedOffset: 1, transform: PARKED },
];

/**
 * The look with no block in play. Every case that predates #1929 is about the
 * roll alone, and spelling that out beats threading an `undefined` through
 * each of them.
 */
const lookOf = (roll: HTMLElement | undefined): MatrixRainLook => creditsRainLook(roll, undefined);

type FadeStop = { readonly computedOffset: number; readonly opacity: string };

/** The `.credits-block` counterpart of `fakeRoll`, carrying the fade. */
function fakeBlock(progress: number | null, stops: readonly FadeStop[]): HTMLElement {
  return {
    getAnimations: () => [
      {
        effect: {
          getComputedTiming: () => ({ progress }),
          getKeyframes: () => stops,
        },
      },
    ],
  } as unknown as HTMLElement;
}

const FADES_FROM_070: readonly FadeStop[] = [
  { computedOffset: 0, opacity: "1" },
  { computedOffset: 0.7, opacity: "1" },
  { computedOffset: 0.82, opacity: "0" },
  { computedOffset: 1, opacity: "0" },
];

describe("credits rain look (#1807)", () => {
  it("is louder than the panel the effect was tuned for, on every knob", () => {
    // The defect was that the credits rain read as a faint texture. Each
    // comparison names the axis it fixes, against the surface whose settings
    // it inherited.
    expect(CREDITS_RAIN_LOOK.glyphAlpha).toBeGreaterThan(ADM_RAIN_LOOK.glyphAlpha);
    expect(CREDITS_RAIN_LOOK.fadeAlpha).toBeLessThan(ADM_RAIN_LOOK.fadeAlpha);
    expect(CREDITS_RAIN_LOOK.leader).not.toBeNull();
    // vjt asked for 0.7x THE CURRENT SPEED, and the current speed is the one
    // the Debug panel still runs at.
    expect(CREDITS_RAIN_LOOK.rowsPerFrame).toBeCloseTo(0.7 * ADM_RAIN_LOOK.rowsPerFrame, 10);
  });

  it("bursts louder still, and faster than its own baseline", () => {
    expect(CREDITS_RAIN_BURST_LOOK.leader).toBe("rgba(255, 255, 255, 1)");
    expect(CREDITS_RAIN_BURST_LOOK.glyphAlpha).toBeGreaterThan(CREDITS_RAIN_LOOK.glyphAlpha);
    expect(CREDITS_RAIN_BURST_LOOK.fadeAlpha).toBeLessThan(CREDITS_RAIN_LOOK.fadeAlpha);
    expect(CREDITS_RAIN_BURST_LOOK.rowsPerFrame).toBeGreaterThan(CREDITS_RAIN_LOOK.rowsPerFrame);
  });

  it("stays on the steady look while the titles are travelling", () => {
    expect(lookOf(fakeRoll(0, PARKS_AT_082))).toBe(CREDITS_RAIN_LOOK);
    expect(lookOf(fakeRoll(0.5, PARKS_AT_082))).toBe(CREDITS_RAIN_LOOK);
    expect(lookOf(fakeRoll(0.8199, PARKS_AT_082))).toBe(CREDITS_RAIN_LOOK);
  });

  it("bursts for exactly the stretch the roll spends parked", () => {
    // The boundary belongs to the interlude: the instant the translate stops
    // moving there is nothing on screen but rain.
    expect(lookOf(fakeRoll(0.82, PARKS_AT_082))).toBe(CREDITS_RAIN_BURST_LOOK);
    expect(lookOf(fakeRoll(0.99, PARKS_AT_082))).toBe(CREDITS_RAIN_BURST_LOOK);
  });

  it("takes the park offset from the keyframes rather than from a constant", () => {
    // Retime the roll and the burst follows, with nothing in TS to edit. A
    // hardcoded 0.82 would keep bursting at 0.82 of a cycle that now parks
    // somewhere else, which is the drift this reader exists to avoid.
    const parksLate: readonly FakeStop[] = [
      { computedOffset: 0, transform: TRAVELLING },
      { computedOffset: 0.95, transform: PARKED },
      { computedOffset: 1, transform: PARKED },
    ];
    expect(lookOf(fakeRoll(0.9, parksLate))).toBe(CREDITS_RAIN_LOOK);
    expect(lookOf(fakeRoll(0.96, parksLate))).toBe(CREDITS_RAIN_BURST_LOOK);
  });

  it("never bursts when there is no interlude to be inside of", () => {
    // #1773's seamless two-stop roll. Reintroduce it and the burst must go
    // away with the hold, not fire against a moving title.
    const seamless: readonly FakeStop[] = [
      { computedOffset: 0, transform: TRAVELLING },
      { computedOffset: 1, transform: PARKED },
    ];
    expect(rollIsParked(fakeRoll(0.999, seamless))).toBe(false);
  });

  it("degrades to the steady look when there is no animation to read", () => {
    // Three real cases, one answer: before the roll mounts, under
    // `prefers-reduced-motion` (where the roll is a plain scrollable column),
    // and in jsdom. None of them is an error, and none of them may throw.
    expect(lookOf(undefined)).toBe(CREDITS_RAIN_LOOK);
    expect(lookOf({ getAnimations: () => [] } as unknown as HTMLElement)).toBe(CREDITS_RAIN_LOOK);
    expect(lookOf(document.createElement("div"))).toBe(CREDITS_RAIN_LOOK);
    expect(lookOf(fakeRoll(null, PARKS_AT_082))).toBe(CREDITS_RAIN_LOOK);
  });
});

describe("credits rain through the first block's fade (#1929)", () => {
  it("bursts while the block dissolves, with the roll still travelling", () => {
    // The whole point of the change. At 0.75 the roll is nowhere near parked,
    // so the #1807 reader alone answers "steady" — and the screen is a block
    // fading into rain, which is exactly when the rain should be loudest.
    expect(lookOf(fakeRoll(0.75, PARKS_AT_082))).toBe(CREDITS_RAIN_LOOK);
    expect(creditsRainLook(fakeRoll(0.75, PARKS_AT_082), fakeBlock(0.75, FADES_FROM_070))).toBe(
      CREDITS_RAIN_BURST_LOOK,
    );
  });

  it("stays steady before the dissolve starts", () => {
    // The boundary belongs to the fade: at the last fully-opaque stop the
    // block is about to start going, and that is the surge.
    expect(creditsRainLook(fakeRoll(0.69, PARKS_AT_082), fakeBlock(0.69, FADES_FROM_070))).toBe(
      CREDITS_RAIN_LOOK,
    );
    expect(creditsRainLook(fakeRoll(0.7, PARKS_AT_082), fakeBlock(0.7, FADES_FROM_070))).toBe(
      CREDITS_RAIN_BURST_LOOK,
    );
  });

  it("takes the dissolve's start from the keyframes rather than from a constant", () => {
    // Same promise `parkOffset` makes: retime the fade in the stylesheet and
    // the surge follows, with nothing in TS to edit.
    const fadesLate: readonly FadeStop[] = [
      { computedOffset: 0, opacity: "1" },
      { computedOffset: 0.9, opacity: "1" },
      { computedOffset: 1, opacity: "0" },
    ];
    expect(blockIsFading(fakeBlock(0.8, fadesLate))).toBe(false);
    expect(blockIsFading(fakeBlock(0.95, fadesLate))).toBe(true);
  });

  it("never claims a dissolve when there is no window to be inside of", () => {
    // A fade that is transparent from the first stop, and one that never
    // stops being opaque. Neither is a dissolve, and reading either as one
    // would leave the rain bursting for a whole pass.
    const alreadyGone: readonly FadeStop[] = [
      { computedOffset: 0, opacity: "0" },
      { computedOffset: 1, opacity: "0" },
    ];
    const neverFades: readonly FadeStop[] = [
      { computedOffset: 0, opacity: "1" },
      { computedOffset: 1, opacity: "1" },
    ];
    expect(blockIsFading(fakeBlock(0.5, alreadyGone))).toBe(false);
    expect(blockIsFading(fakeBlock(0.99, neverFades))).toBe(false);
  });

  it("degrades to no-dissolve when there is no block to read", () => {
    // Four real cases: before the modal mounts, after the first pass has
    // taken the block away, under `prefers-reduced-motion` (no animation at
    // all), and in jsdom. None may throw, and none may burst.
    expect(blockIsFading(undefined)).toBe(false);
    expect(blockIsFading({ getAnimations: () => [] } as unknown as HTMLElement)).toBe(false);
    expect(blockIsFading(document.createElement("div"))).toBe(false);
    expect(blockIsFading(fakeBlock(null, FADES_FROM_070))).toBe(false);
  });
});

/**
 * How long `<selector>` declares `<name>` to run, in seconds.
 *
 * #1929 hoisted this out of the roll's own describe: the fade has to be
 * checked against the roll's duration, so two callers need it and neither may
 * carry a tweaked copy.
 */
function animationSeconds(selector: string, name: string): number {
  const declared = new RegExp(`animation:\\s*${name}\\s+([\\d.]+)s`).exec(ruleBody(selector));
  const seconds = Number(declared?.[1]);
  expect(Number.isFinite(seconds), `no ${name} duration on ${selector}`).toBe(true);
  return seconds;
}

/**
 * The stops of `@keyframes <name>`, as `{ at, value }` for ONE property. The
 * block has nested braces, so it is matched up to the first `}` at column 0.
 */
function keyframeStops(name: string, property: string): { at: number; value: string }[] {
  const block = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(themeCss)?.[1];
  expect(block, `@keyframes ${name} not found in default.css`).toBeDefined();
  const parsed = [
    ...(block ?? "").matchAll(new RegExp(`(\\d+)%\\s*\\{\\s*${property}:\\s*([^;]+);`, "g")),
  ].map((m) => ({ at: Number(m[1]) / 100, value: (m[2] ?? "").trim() }));
  expect(parsed.length, `@keyframes ${name} has no ${property} stops`).toBeGreaterThanOrEqual(2);
  return parsed;
}

/** Where `@keyframes credits-roll` stops travelling — the interlude's start. */
function rollParksAt(): number {
  const all = keyframeStops("credits-roll", "transform");
  const park = all.find((stop) => stop.value === all.at(-1)?.value);
  expect(park?.at, "the last two stops must share a transform, or there is no hold").toBeLessThan(
    1,
  );
  return park?.at ?? 1;
}

describe("credits roll timing (#1807 — the stylesheet owns the interlude)", () => {
  const cycleSeconds = (): number => animationSeconds(".credits-roll", "credits-roll");
  const stops = (): { at: number; value: string }[] => keyframeStops("credits-roll", "transform");

  it("parks the roll off the top for the 5-7s of pure rain the issue asked for", () => {
    const all = stops();
    const last = all.at(-1);
    expect(last?.at).toBe(1);

    // The hold starts at the FIRST stop already carrying the final transform.
    const park = all.find((stop) => stop.value === last?.value);
    expect(park?.at, "the last two stops must share a transform, or there is no hold").toBeLessThan(
      1,
    );

    const interlude = cycleSeconds() * (1 - (park?.at ?? 1));
    expect(interlude).toBeGreaterThanOrEqual(5);
    expect(interlude).toBeLessThanOrEqual(7);
  });

  it("holds it OFF-SCREEN, and re-enters from the bottom EDGE", () => {
    // Not a pause mid-list: the parked transform is the one that has the roll
    // fully above the fold, and the cycle restarts from below the bottom of
    // the WINDOW — the same entrance as the first pass.
    //
    // #1920: this test used to pin `translateY(100%)` here while its own name
    // claimed "from the bottom", and the two disagreed. A percentage translate
    // resolves against the element's own border box, so 100% parks the roll's
    // top edge at its own height — below the fold only for a roll TALLER than
    // the window. With nine contributors it is a few hundred px against a
    // ~1000px viewport, so every cycle began with the titles already halfway
    // up the screen (vjt, #grappa: "riappaiono in mezzo allo schermo").
    //
    // So the assertion is on the UNIT, not on a number: the entrance has to be
    // viewport-relative or the defect is back, and no roll height can make a
    // `%` entrance correct on every window.
    const all = stops();
    expect(all[0]?.value).toMatch(/^translateY\(100d?vh\)$/);
    expect(all.at(-1)?.value).toBe("translateY(-100%)");
  });

  it("keeps the exit self-relative, because clearing the top is about the ROLL", () => {
    // The asymmetry is deliberate and worth a test of its own, since it reads
    // like an oversight: the roll leaves when it has travelled its OWN height
    // past the top edge, which is a fact about the roll, while it arrives from
    // the window's bottom, which is a fact about the window. Swapping either
    // for the other's unit breaks a different size of roll.
    const all = stops();
    const exits = all.filter((stop) => stop.value.includes("-100%"));
    expect(exits.length).toBeGreaterThanOrEqual(2);
  });

  it("carries a vh fallback for engines with no dynamic-viewport units", () => {
    // #205's posture, applied to the roll: biome forbids the classic
    // `transform: translateY(100vh); transform: translateY(100dvh)` duplicate,
    // so the fallback is a whole re-declaration of the animation under
    // `@supports not (height: 100dvh)`. Without it, Safari < 15.4 drops the
    // 0% stop entirely and the roll starts at translate zero — which is
    // mid-screen, i.e. exactly the bug this issue closed.
    const fallback = mediaGatedBlocks(
      /@supports\s*not\s*\(\s*height\s*:\s*100dvh\s*\)\s*\{/g,
      "@supports not (height: 100dvh)",
    ).find((block) => block.includes("@keyframes credits-roll"));
    expect(fallback, "no dvh fallback for @keyframes credits-roll").toBeDefined();
    expect(fallback).toMatch(/transform:\s*translateY\(100vh\)/);
  });

  it("did not slow the titles down to buy the interlude", () => {
    // #1773 rolled the whole 28s cycle. The interlude is bought by a LONGER
    // cycle, so the travel — and therefore how long a reader has to read each
    // name — is where it was.
    const all = stops();
    const park = all.find((stop) => stop.value === all.at(-1)?.value);
    expect(cycleSeconds() * (park?.at ?? 1)).toBeCloseTo(28, 0);
  });
});

describe("the first block's fade (#1929 — the stylesheet owns the seam)", () => {
  const fadeStops = (): { at: number; value: string }[] =>
    keyframeStops("credits-block-fade", "opacity");

  it("runs on the roll's clock, not on one of its own", () => {
    // Two animations, one cycle. If they ever declared different durations the
    // dissolve would slide against the travel a little more on every pass, and
    // nothing else in the modal would notice.
    //
    // #1931 moved the declaration off `.credits-block` onto a second class the
    // finale omits — the block comes back for the ending, and a re-mounted
    // `1 forwards` would dissolve it as it arrives. The property pinned here is
    // unchanged; only the selector carrying it moved.
    expect(animationSeconds(".credits-block-fading", "credits-block-fade")).toBe(
      animationSeconds(".credits-roll", "credits-roll"),
    );
  });

  it("finishes dissolving exactly where the roll finishes travelling", () => {
    // The seam. The block must be gone by the time the interlude starts, or
    // the "pure rain" stretch has a half-transparent block sitting in it.
    const gone = fadeStops().find((stop) => Number(stop.value) === 0);
    expect(gone?.at, "the fade never reaches opacity 0").toBeDefined();
    expect(gone?.at).toBe(rollParksAt());
  });

  it("leaves a dissolve long enough to read as a fade, not as a cut", () => {
    // 3-6s of it. A shorter window is a cut with extra steps; a longer one
    // eats the names.
    const all = fadeStops();
    const opaqueUntil = all.filter((stop) => Number(stop.value) === 1).at(-1)?.at;
    expect(opaqueUntil, "the fade is transparent from its first stop").toBeGreaterThan(0);
    const dissolve =
      animationSeconds(".credits-roll", "credits-roll") * (rollParksAt() - (opaqueUntil ?? 0));
    expect(dissolve).toBeGreaterThanOrEqual(3);
    expect(dissolve).toBeLessThanOrEqual(6);
  });

  it("runs ONCE and holds, so the prose that follows is never faded", () => {
    // `infinite` here would dim every later pass, and `forwards` is what keeps
    // the block invisible through the parked tail rather than snapping it back
    // to opaque for the last six seconds.
    const declared = ruleBody(".credits-block-fading");
    expect(declared).toMatch(/animation:[^;]*\bcredits-block-fade\b[^;]*\b1\b/);
    expect(declared).toMatch(/animation:[^;]*\bforwards\b/);
    expect(declared).not.toMatch(/animation:[^;]*\binfinite\b/);
  });
});
