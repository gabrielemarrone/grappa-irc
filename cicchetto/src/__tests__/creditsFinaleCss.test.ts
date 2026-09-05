import { describe, expect, it } from "vitest";
import { mediaGatedBlocks, ruleBody, themeCss } from "./helpers/themeCss";

// #1931 — the stylesheet's half of the ending, and the two things in it that
// cannot be read off the component.
//
// The ending STOPS the roll. That is not a flourish: everything in this modal
// travels, so a close button that scrolls off the top is a button the reader
// waits a full 34s cycle for. Stopping it is also what settles the rain around
// the heart, and it does that with no code at all — both readers in
// `creditsRain` ask the roll's animation what phase it is in, and an element
// with `animation: none` has none to report, which they already answer
// "steady" to. So "the rain must not fight the heart" is satisfied by the same
// declaration that keeps the button reachable, rather than by a third clock.

/** The declarations `prefers-reduced-motion` gives one selector, if any. */
function reducedMotionBody(selector: string): string {
  const blocks = mediaGatedBlocks(/@media \(prefers-reduced-motion: reduce\) \{/g, "reduced-motion");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  for (const block of blocks) {
    const found = block.match(re)?.[1];
    if (found !== undefined) return found;
  }
  throw new Error(`no reduced-motion rule for ${selector}`);
}

/** `prop: value` pairs of a rule body, order-independent. */
function declarations(body: string): string[] {
  return body
    .split(";")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort();
}

describe("the ending stops the roll (#1931)", () => {
  it("parks it the same way reduced-motion already does, declaration for declaration", () => {
    // CSS cannot share a rule across a media boundary, so these two carry the
    // same text twice. This is what keeps the copies in step — a comment
    // asking the next reader to remember is what let them drift in the first
    // place. Compared as a SET, so reordering them is not a failure.
    expect(declarations(ruleBody(".credits-roll-ended"))).toEqual(
      declarations(reducedMotionBody(".credits-roll")),
    );
    expect(declarations(ruleBody(".credits-viewport-ended"))).toEqual(
      declarations(reducedMotionBody(".credits-viewport")),
    );
  });

  it("actually turns the travel off, rather than merely restyling it", () => {
    // The positive control for the pair above: if BOTH sides were edited to
    // something that still animates, the equality test would go on passing
    // while the close button sailed off the top.
    expect(ruleBody(".credits-roll-ended")).toMatch(/animation:\s*none/);
    expect(ruleBody(".credits-roll-ended")).toMatch(/position:\s*static/);
    // ...and the travelling roll still travels, or there is nothing to stop.
    expect(ruleBody(".credits-roll")).toMatch(/animation:\s*credits-roll\s/);
  });

  it("keeps the block's fade OFF the block itself", () => {
    // The block comes back for the finale. The fade is `1 forwards`, so a
    // re-mounted element carrying it would dissolve the ending as it arrives —
    // which is why the animation lives on a second class the finale omits.
    expect(ruleBody(".credits-block")).not.toMatch(/animation:/);
    expect(ruleBody(".credits-block-fading")).toMatch(/animation:[^;]*credits-block-fade/);
  });
});

describe("the pulsing heart (#1931)", () => {
  it("pulses", () => {
    expect(ruleBody(".credits-heart")).toMatch(/animation:[^;]*credits-heart-pulse/);
  });

  it("stops pulsing under prefers-reduced-motion, like the rest of the modal", () => {
    // The issue asks for this by name. A heart that keeps beating through a
    // reduce request is the one element in the modal that ignores it.
    expect(reducedMotionBody(".credits-heart")).toMatch(/animation:\s*none/);
  });

  it("beats rather than throbs", () => {
    // Two peaks and a rest inside one cycle — a heartbeat, not a sine. A
    // single-peak keyframe set reads as a loading spinner, and that is the
    // difference the animation exists for.
    const frames = /@keyframes credits-heart-pulse\s*\{([\s\S]*?)\n\}/.exec(themeCss)?.[1];
    expect(frames, "@keyframes credits-heart-pulse not found").toBeDefined();
    const scales = [...(frames ?? "").matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(scales.filter((s) => s > 1).length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...scales)).toBeGreaterThan(1);
  });
});
