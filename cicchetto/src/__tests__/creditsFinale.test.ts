import { describe, expect, it } from "vitest";
import {
  CREDITS_CLOSE_LABEL,
  CREDITS_FINALE_LINE,
  CREDITS_HEART,
  CREDITS_MANIFESTO,
  CREDITS_MANIFESTO_ATTRIBUTION,
} from "../lib/creditsFinale";
import { CREDITS_PROSE, PROSE_SET_MAX_WORDS } from "../lib/creditsProse";

// #1931 — the finale's content.
//
// Two constants here were PLACEHOLDERS awaiting vjt, and that is why this file
// exists as a test rather than as a comment: a placeholder nobody can find is
// a placeholder that ships. Both were settled on 2026-09-06 — the closing line
// approved as written (with `folks` for `friends`), the manifesto cleared for
// inclusion by the repository's owner. The tests below no longer guard an
// empty slot; they pin what ships, and the one thing that has not changed is
// that the words live behind ONE named constant each.

describe("the heart (#1931)", () => {
  it("is the ASCII <3 and not an emoji", () => {
    // vjt: "il cuore e' <3, non un'emoji" — this is a terminal-flavoured
    // client, and a rendered ♥ is a different joke. Asserted by CODE POINT,
    // because the two are indistinguishable in a diff at a glance.
    expect(CREDITS_HEART).toBe("<3");
    for (const char of CREDITS_HEART) {
      expect(char.codePointAt(0), `${char} is outside ASCII`).toBeLessThan(0x80);
    }
  });
});

describe("the closing line (#1931 — approved by vjt, 2026-09-06)", () => {
  it("is one line, behind one named constant", () => {
    // The words are settled; what is pinned here is the SHAPE, which is what
    // a later reword can still break. It stays a single line: the finale lays
    // it out under the heart, and a paragraph there would push the close
    // button off a phone.
    expect(CREDITS_FINALE_LINE).not.toContain("\n");
    expect(CREDITS_FINALE_LINE.trim()).toBe(CREDITS_FINALE_LINE);
    expect(CREDITS_FINALE_LINE.length).toBeGreaterThan(0);
  });

  it("does not quote Looney Tunes", () => {
    // The issue's own reason: "That's all Folks!" is a Warner Bros. TRADEMARK
    // and trademarks do not expire. Cadence, not quotation — so the one string
    // the finale must never carry is that one.
    expect(CREDITS_FINALE_LINE.toLowerCase()).not.toContain("that's all folks");
    expect(CREDITS_FINALE_LINE.toLowerCase()).not.toContain("looney");
    expect(CREDITS_FINALE_LINE.toLowerCase()).not.toContain("porky");
  });
});

describe("the close button (#1931)", () => {
  it("says what it does, in one short label", () => {
    expect(CREDITS_CLOSE_LABEL.length).toBeGreaterThan(0);
    expect(CREDITS_CLOSE_LABEL).not.toContain("\n");
  });
});

describe("the manifesto (#1931 — cleared by vjt, 2026-09-06)", () => {
  // "The Conscience of a Hacker", The Mentor (Loyd Blankenship), Phrack 7:3,
  // 8 January 1986.
  //
  // These tests were a TRIPWIRE while the text was blocked: they asserted the
  // slot was still empty and failed if the real lines appeared. vjt cleared it
  // as the repository's owner, so the tripwire is gone and what remains pins
  // what SHIPS. The three properties below are the ones a careless edit
  // actually breaks.

  it("carries the text, and the credit that is a condition of carrying it", () => {
    // Together, deliberately: the attribution is not decoration, it is the
    // term on which the text is here. A future edit that drops the credit
    // while keeping the words is the failure this pairing exists to catch.
    expect(CREDITS_MANIFESTO.toLowerCase()).toContain("another one got caught today");
    expect(CREDITS_MANIFESTO.toLowerCase()).toContain("i am a hacker, and this is my manifesto");
    expect(CREDITS_MANIFESTO_ATTRIBUTION).toContain("Loyd Blankenship");
    expect(CREDITS_MANIFESTO_ATTRIBUTION).toContain("Phrack");
    expect(CREDITS_MANIFESTO_ATTRIBUTION).toContain("1986");
  });

  it("keeps the Phrack header art, backslashes and all", () => {
    // `String.raw`, not a plain template literal. In a plain one `\/` is an
    // escape for `/`, so the header would silently arrive as `//The
    // Conscience of a Hacker///` — a corruption with no error anywhere and
    // nothing in a diff to catch the eye.
    expect(CREDITS_MANIFESTO).toContain(String.raw`\/\The Conscience of a Hacker/\/`);
  });

  it("has no leading whitespace on any line", () => {
    // vjt asked for the indent to go, and the slot renders `white-space:
    // pre-wrap` in a 64ch column: what was pasted in carried a runaway
    // auto-indent (past 100 columns) that wraps into noise on a phone. One
    // rule, applied to every line, so there is no second level to drift.
    const indented = CREDITS_MANIFESTO.split("\n").filter((line) => /^\s+/.test(line));
    expect(indented, "lines still carrying an indent").toEqual([]);
    // ...and the paragraph breaks that do the structuring instead are still there.
    expect(CREDITS_MANIFESTO).toContain("\n\n");
  });

  it("does not buy its length by raising the prose word cap", () => {
    // ~570 words against the ceiling the ordinary sets live under. vjt accepts
    // the length for THIS block and only this one, which is exactly WHY it is
    // a block of its own — the cheap alternative is to raise the cap until the
    // manifesto fits, and that silently un-bounds all sixteen sets that the
    // cap exists to keep readable.
    //
    // Pinned as a NUMBER rather than as "the sets still pass": every set could
    // still pass a cap raised to 600. This is the move being forbidden. The
    // pin does not care WHY the number moves — it cannot read intent — so it
    // makes any move an argued diff instead of a quiet edit.
    //
    // ⚠️ RETRACTION. This assertion read 150 and the comment said the issue's
    // "PROSE_SET_MAX_WORDS (300 after the raise)" described a raise that never
    // happened. The measurement was right and the conclusion was wrong: the
    // raise existed as an unlanded PR, not as a commit, so searching history
    // could not see it. It landed while this branch waited (the copy rewrite),
    // and the cap is 300. The manifesto is ~1.9x the cap, not ~3.8x — the
    // margin the issue always claimed, and still ample enough that fitting the
    // manifesto in would take a raise nobody could make silently.
    //
    // The general lesson, since this is the second thing here to be caught by
    // it: `git log -S` answers "is it in the history of THIS ref", never "does
    // it exist". Against work in flight those are different questions.
    expect(PROSE_SET_MAX_WORDS).toBe(300);
    // ...and the manifesto is not in the pool it bounds. A set added there
    // would be capped; this block deliberately is not, so it must not be one.
    expect(CREDITS_PROSE.some((set) => set.paragraphs.includes(CREDITS_MANIFESTO))).toBe(false);
  });
});
