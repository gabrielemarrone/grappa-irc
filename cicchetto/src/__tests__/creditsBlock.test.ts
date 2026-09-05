import { describe, expect, it } from "vitest";
import { CREDITS_COW, CREDITS_SPECIAL_THANKS, cowSaying } from "../lib/creditsBlock";

// #1929 — the cow and the special thanks, the two halves of the first block
// that are DICTATED rather than derived.
//
// Both are content someone handed us, so the tests here are pins rather than
// behaviour checks, and that is the point: the failure they exist to catch is
// a future tidy-up "improving" a list vjt wrote out by hand, or a cow that
// drifted off the ASCII it was copied from. There is nothing to compute, so
// there is nothing to assert except sameness — and sameness against the
// ORIGINAL, never against a second copy of ourselves.

/** What bahamut's own cow says, so the generator can be fed the original. */
const BAHAMUT_SAYS = "This bahamut has Super Cow Powers !";

/**
 * bahamut's eight lines exactly as its `/info` prints them, transcribed from
 * `azzurra/bahamut src/version.c.SH:145-152`. The source is a shell heredoc
 * generating C, so every backslash is written there as four; this is what
 * reaches a terminal after both collapses.
 *
 * One quoted string per line rather than one template literal, for TWO
 * reasons that both bite silently:
 *
 *   * the two rules END IN A SPACE, and trailing whitespace inside a
 *     multi-line template is invisible in review and eaten by half the tools
 *     that touch a file — inside quotes it survives, and it can be seen;
 *   * the tail line ends in a BACKSLASH, and `String.raw` does not save you
 *     from that: `\` still escapes the closing backtick at the tokenizer, so
 *     the template silently swallows the rest of the file.
 *
 * Hence `\\` per backslash, in ordinary quotes.
 */
const BAHAMUT_COW = [
  " _____________________________________ ",
  "< This bahamut has Super Cow Powers ! >",
  " ------------------------------------- ",
  "        \\   ^__^",
  "         \\  (oo)\\_______",
  "            (__)\\       )\\/\\",
  "                ||----w |",
  "                ||     ||",
].join("\n");

const lines = (): readonly string[] => CREDITS_COW.split("\n");

describe("the cowsay (#1929 — bahamut's cow, speaking for grappa)", () => {
  it("reproduces bahamut's cow EXACTLY when fed bahamut's sentence", () => {
    // The positive control on the balloon builder, and the assertion that
    // earns the right to generate the box instead of transcribing it: given
    // the original sentence, the generator emits the original eight lines,
    // underscore for underscore. If it did not, every claim below about "the
    // same cow" would be a claim about a lookalike.
    expect(cowSaying(BAHAMUT_SAYS)).toBe(BAHAMUT_COW);
  });

  it("keeps bahamut's cow body byte-for-byte", () => {
    // The ASCII is REUSED, not redrawn. A cow that merely looks similar is a
    // different cow, and the whole point of the reference is that this is the
    // one Azzurra's /info has been printing for twenty years.
    const body = BAHAMUT_COW.split("\n").slice(3).join("\n");
    expect(CREDITS_COW.endsWith(body)).toBe(true);
  });

  it("speaks for grappa, and no longer for bahamut", () => {
    expect(CREDITS_COW).toContain("This grappa has Super Cow Powers !");
    expect(CREDITS_COW).not.toContain("bahamut");
  });

  it("keeps the balloon square around whatever the cow says", () => {
    // The three balloon lines must be the same width or the box is visibly
    // broken. This is the assertion that makes editing the text safe: change
    // the sentence and the rules follow, because they are measured from it.
    const [top, said, bottom] = lines();
    expect(top).toBeDefined();
    expect(said).toBeDefined();
    expect(bottom).toBeDefined();
    expect(top?.length).toBe(said?.length);
    expect(bottom?.length).toBe(said?.length);
  });

  it("draws the balloon the way cowsay does, one line and no wrap", () => {
    const [top, said, bottom] = lines();
    // Bahamut's own shape: a space-flanked rule of underscores, the text
    // between `< ` and ` >`, a space-flanked rule of dashes.
    expect(top).toMatch(/^ _+ $/);
    expect(bottom).toMatch(/^ -+ $/);
    expect(said).toMatch(/^< .* >$/);
  });

  it("is a `pre` block's worth of lines, not a paragraph", () => {
    // Three balloon lines plus five body lines. A cow that lost a line still
    // renders, which is why the count is pinned and not inferred.
    expect(lines()).toHaveLength(8);
  });
});

describe("the special thanks (#1929 — dictated, copied verbatim)", () => {
  // vjt dictated this list in the issue. It is reproduced here in full and in
  // order, so that changing the shipped list without changing this file is a
  // RED — which is exactly the friction wanted around someone else's words.
  const DICTATED: readonly (readonly [string, string])[] = [
    ["Hypnotize, Mezmerize, Sonic, scorpion, joep", "for keeping Azzurra standing"],
    ["DeepSET / Johnny^Lizard", "for embracing grappa and spreading it far and wide"],
    ["tsk", "for suggesting Erlang"],
    ["peluche", "most assiduous betatester"],
    ["nextime", "for shottino"],
    ["Lucy", "for resentin"],
    ["Sonic", "for bicchierino"],
    [
      "morph",
      "for spreading grappa, bringing people back, and throwing himself at the ircd and the services again",
    ],
    ["the whole #sniffo crew", "for still being here"],
  ];

  it("carries every name that was dictated, in the order it was dictated", () => {
    expect(CREDITS_SPECIAL_THANKS.map((entry) => [entry.who, entry.why])).toEqual(
      DICTATED.map((entry) => [...entry]),
    );
  });

  it("thanks Sonic TWICE, because that is what was dictated", () => {
    // Sonic is named once among the people keeping Azzurra standing and once
    // for bicchierino. They are two different thanks for two different things
    // and collapsing them would be editing vjt's words — the exact "helpful"
    // cleanup this test exists to fail.
    const sonicLines = CREDITS_SPECIAL_THANKS.filter((entry) => entry.who.includes("Sonic"));
    expect(sonicLines).toHaveLength(2);
  });

  it("says nothing this codebase invented", () => {
    // A guard against a name being ADDED. The count is the cheapest total
    // statement about the list, and the one an insertion cannot slip past.
    expect(CREDITS_SPECIAL_THANKS).toHaveLength(DICTATED.length);
  });
});
