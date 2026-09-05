// #1931 — the credits' ENDING: what is shown once the prose deck has dealt
// every set it has.
//
// Sibling of `creditsBlock.ts`, and split from it along the same line that
// file draws: `creditsBlock` owns the content of the FIRST block (the cow, the
// special thanks), this one owns the content of the LAST. Between them run the
// `creditsProse` sets, which are the only part of the sequence that repeats.
//
// 🔴 TWO CONSTANTS HERE ARE PLACEHOLDERS AWAITING vjt, and neither is the
// implementer's to write:
//
//   CREDITS_FINALE_LINE   the "that's all, folks!" in cypherpunk register.
//                         The issue says outright that the exact wording is
//                         vjt's call. What ships below is a stand-in.
//   CREDITS_MANIFESTO     "The Conscience of a Hacker". BLOCKED on more than
//                         wording — see below.
//
// Each sits behind ONE named constant, in ONE place, pinned by
// `creditsFinale.test.ts`, so filling either in is a one-line edit. The tests
// assert the SHAPE a replacement has to keep, never the words, and they are
// what makes a forgotten placeholder visible instead of shipped.

/** The heart, in ASCII. */
export const CREDITS_HEART = "<3";

/**
 * 🔴 PLACEHOLDER — awaiting vjt's wording.
 *
 * The brief asks for Looney Tunes CADENCE and cypherpunk REGISTER: the shape
 * of an ending anybody recognises, saying something this project would say.
 * What it must never be is the quotation itself — "That's all Folks!" is a
 * Warner Bros. trademark, and a trademark does not expire with the copyright
 * on the tune. `creditsFinale.test.ts` forbids the quotation by name.
 *
 * One line, no newline: the finale lays it out between the heart and the
 * close button, and a paragraph there pushes the button off a phone.
 */
export const CREDITS_FINALE_LINE = "and that's the whole of the wire, friends.";

/** What the finale's own close control says. */
export const CREDITS_CLOSE_LABEL = "click here to close";

/**
 * 🔴 PLACEHOLDER — and this one is BLOCKED on permission, not on wording.
 *
 * The finale is supposed to show "The Conscience of a Hacker" (The Mentor —
 * Loyd Blankenship, *Phrack* Vol. 1 Issue 7 Phile 3, 8 January 1986)
 * immediately before the heart. vjt's instruction is verbatim: **do not
 * include it until vjt confirms in writing on #grappa.**
 *
 * The reason is not squeamishness. The text is from 1986, was never dedicated
 * to the public domain and was never put under a free licence. It has been
 * reproduced everywhere for forty years, but that is CUSTOM and not
 * PERMISSION — and grappa ships a public PWA and a `.deb`, which is the same
 * reason `creditsAudio.ts` synthesises its music instead of sampling any.
 *
 * So the BLOCK is built and the TEXT is not: swapping this constant for the
 * real thing is the entire change, and `CREDITS_MANIFESTO_ATTRIBUTION` below
 * is already rendered beside it so the credit cannot arrive as an
 * afterthought. `creditsFinale.test.ts` fails if the manifesto's own words
 * turn up here before that happens.
 */
export const CREDITS_MANIFESTO =
  "— the manifesto goes here, once its licence is settled in writing —";

/**
 * The credit the manifesto ships WITH, written now rather than later.
 *
 * A slot that arrives without an attribution is how a text ends up shipping
 * without one: the words are the interesting part to paste in, the credit is
 * the part that gets left for a follow-up nobody files.
 */
export const CREDITS_MANIFESTO_ATTRIBUTION =
  "The Mentor (Loyd Blankenship) — Phrack Vol. 1, Issue 7, Phile 3, 8 January 1986";

/**
 * Is the manifesto still the placeholder above?
 *
 * Exported so the tripwire is a function of the constant rather than a second
 * copy of the placeholder string sitting in a test — the failure mode of a
 * duplicated sentinel is that somebody fills the constant in and the test goes
 * on comparing against its own stale copy, reporting green.
 */
export function manifestoAwaitingClearance(): boolean {
  return CREDITS_MANIFESTO.startsWith("—");
}
