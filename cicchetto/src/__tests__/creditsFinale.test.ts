import { describe, expect, it } from "vitest";
import {
  CREDITS_CLOSE_LABEL,
  CREDITS_FINALE_LINE,
  CREDITS_HEART,
  CREDITS_MANIFESTO,
  CREDITS_MANIFESTO_ATTRIBUTION,
  manifestoAwaitingClearance,
} from "../lib/creditsFinale";
import { CREDITS_PROSE, PROSE_SET_MAX_WORDS } from "../lib/creditsProse";

// #1931 — the finale's content, and the two pieces of it that are NOT ours.
//
// Two constants here are PLACEHOLDERS awaiting vjt, and that is the whole
// reason this file exists as a test rather than as a comment: a placeholder
// nobody can find is a placeholder that ships. Each one is pinned to a single
// named constant, and the tests below assert the shape a replacement has to
// keep rather than the words, so filling one in is a one-line edit that stays
// green — and forgetting to fill it in is visible from here.

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

describe("the closing line (#1931 — vjt's words, not ours)", () => {
  it("is one line, behind one named constant", () => {
    // The wording is dictated and has not arrived. What IS pinned is that it
    // stays a single line: the finale lays it out under the heart, and a
    // paragraph there would push the close button off a phone.
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

describe("the manifesto slot (#1931 — BLOCKED on written clearance)", () => {
  // "The Conscience of a Hacker", The Mentor, Phrack 7:3 (1986). vjt's
  // instruction is verbatim: *do not include it until vjt confirms in writing
  // on #grappa*. It is 1986, never dedicated to the public domain and never
  // put under a free licence; forty years of universal reproduction is custom,
  // not permission.
  //
  // So the BLOCK is built and the TEXT is not. These tests are the tripwire.

  it("is still a placeholder, and says so out loud", () => {
    expect(manifestoAwaitingClearance()).toBe(true);
  });

  it("carries none of the manifesto's actual words", () => {
    // The opening and the two most-quoted lines. If any of these appear, the
    // text has been pasted in and this test is the thing that says so before
    // a licence question ships in a `.deb`.
    const forbidden = [
      "another one got caught today",
      "this is our world now",
      "the world of the electron and the switch",
      "my crime is that of curiosity",
      "you may stop this individual",
    ];
    const haystack = CREDITS_MANIFESTO.toLowerCase();
    for (const line of forbidden) {
      expect(haystack, `the manifesto text is in the tree: "${line}"`).not.toContain(line);
    }
  });

  it("already names the author and the source it would ship with", () => {
    // Prepared NOW rather than when the text lands: the attribution is a
    // condition of shipping it at all, and a slot that arrives without one is
    // how it ends up shipping without one.
    expect(CREDITS_MANIFESTO_ATTRIBUTION).toContain("Loyd Blankenship");
    expect(CREDITS_MANIFESTO_ATTRIBUTION).toContain("Phrack");
    expect(CREDITS_MANIFESTO_ATTRIBUTION).toContain("1986");
  });

  it("does not buy its length by raising the prose word cap", () => {
    // ~570 words against the ceiling the ordinary sets live under. vjt accepts
    // the length for THIS block and only this one, which is exactly WHY it is
    // a block of its own — the cheap alternative is to raise the cap until the
    // manifesto fits, and that silently un-bounds all sixteen sets that the
    // cap exists to keep readable.
    //
    // Pinned as a NUMBER rather than as "the sets still pass": every set could
    // still pass a cap raised to 600. This is the move being forbidden.
    //
    // ⚠️ The number is 150, MEASURED. The issue says "PROSE_SET_MAX_WORDS
    // (300 after the raise)" and no such raise exists: `git log -S
    // 'PROSE_SET_MAX_WORDS = 300'` on this file returns nothing, while the
    // same search for `= 150` returns the commit that introduced it
    // (31fa3bd92). The manifesto is therefore ~3.8x the cap rather than ~1.9x,
    // which makes the case for a separate block stronger, not weaker.
    expect(PROSE_SET_MAX_WORDS).toBe(150);
    // ...and the manifesto is not in the pool it bounds. A set added there
    // would be capped; this block deliberately is not, so it must not be one.
    expect(CREDITS_PROSE.some((set) => set.paragraphs.includes(CREDITS_MANIFESTO))).toBe(false);
  });
});
