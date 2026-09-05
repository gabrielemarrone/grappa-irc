import { describe, expect, it } from "vitest";
import {
  CREDITS_PROSE,
  createProseDeck,
  PROSE_SET_MAX_WORDS,
  type ProseSet,
  proseSetWords,
} from "../lib/creditsProse";

// #1924 — the prose between the passes of the credit roll.
//
// Two things are worth pinning here and they are different in kind.
//
// The COPY assertions are a bound on editing: the roll travels a fixed
// distance in a fixed time, so a set that grows does not scroll slower, it
// scrolls past unread. Nobody notices that in review — the modal looks fine
// on a desktop where the whole set fits — so the ceiling is a test rather
// than a comment nobody reads before adding the seventeenth set.
//
// The DECK assertions are about a property uniform sampling does not have.
// `Math.random()` per pass repeats the set you just read about one pass in
// sixteen, and a title sequence that shows the same paragraph twice running
// reads as a bug rather than as chance. The bag is what removes that, and the
// interesting case is the seam BETWEEN two bags, which is the one place a
// naive shuffle-bag still repeats.

/** A scripted random source, so a shuffle has exactly one outcome. */
function scriptedRandom(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

const PAIR: readonly ProseSet[] = [
  { title: "a", paragraphs: ["a"] },
  { title: "b", paragraphs: ["b"] },
];

describe("CREDITS_PROSE copy (#1924)", () => {
  it("carries enough sets that a repeat is far apart", () => {
    // vjt asked for 10-15; the deck deals all of them before repeating, so
    // this number IS the distance between two showings of the same set.
    expect(CREDITS_PROSE.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps every set to two or three paragraphs", () => {
    for (const set of CREDITS_PROSE) {
      expect(set.paragraphs.length).toBeGreaterThanOrEqual(2);
      expect(set.paragraphs.length).toBeLessThanOrEqual(3);
    }
  });

  it("titles every set", () => {
    // The title is rendered, in italics, above the paragraphs — a set that
    // shipped without one would render a blank line the roll spends seconds
    // crossing, which is the same defect as a blank paragraph.
    for (const set of CREDITS_PROSE) {
      expect(set.title.trim()).not.toBe("");
    }
  });

  it("keeps every set under the word ceiling", () => {
    for (const set of CREDITS_PROSE) {
      expect(proseSetWords(set)).toBeLessThanOrEqual(PROSE_SET_MAX_WORDS);
    }
  });

  it("has no blank paragraph", () => {
    // A blank one is invisible in the source and renders as a gap the roll
    // spends seconds crossing.
    for (const set of CREDITS_PROSE) {
      for (const paragraph of set.paragraphs) {
        expect(paragraph.trim()).not.toBe("");
      }
    }
  });
});

describe("createProseDeck (#1924)", () => {
  it("deals every set once before dealing any of them twice", () => {
    const deck = createProseDeck(CREDITS_PROSE, scriptedRandom([0.17, 0.83, 0.41, 0.66]));
    const drawn = Array.from({ length: CREDITS_PROSE.length }, () => deck.draw());
    expect(new Set(drawn).size).toBe(CREDITS_PROSE.length);
  });

  it("never deals the same set twice in a row, across the reshuffle too", () => {
    // The scripted values are chosen for the SEAM: the first bag deals `b`
    // then `a`, and the second bag would open on `a` again. Unguarded this
    // sequence is b,a,a,b — the exact defect the bag exists to remove.
    const deck = createProseDeck(PAIR, scriptedRandom([0.9, 0.0]));
    const drawn = Array.from({ length: 8 }, () => deck.draw());
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]).not.toBe(drawn[i - 1]);
    }
  });

  it("holds the no-repeat property over many passes with a plain generator", () => {
    // A linear congruential generator rather than `Math.random`, so a failure
    // is reproducible instead of a flake somebody re-runs until it is green.
    let state = 12345;
    const lcg = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const deck = createProseDeck(CREDITS_PROSE, lcg);
    let previous: ProseSet | null = null;
    for (let i = 0; i < 2000; i++) {
      const set = deck.draw();
      expect(set).not.toBe(previous);
      previous = set;
    }
  });

  it("deals the only set it has rather than refusing to repeat", () => {
    // One set means every pass shows it. Refusing the repeat here would mean
    // dealing nothing, which is worse than a paragraph you have read.
    const only = { title: "only", paragraphs: ["only"] };
    const deck = createProseDeck([only]);
    expect(deck.draw()).toBe(only);
    expect(deck.draw()).toBe(only);
  });

  it("deals null from an empty pool instead of hanging", () => {
    // Not defensive: a pool this module ships cannot be empty, but a caller
    // filtering the pool can hand one over, and an empty bag that reshuffles
    // into another empty bag is an infinite loop, not a missing paragraph.
    const deck = createProseDeck([]);
    expect(deck.draw()).toBeNull();
    expect(deck.draw()).toBeNull();
  });
});

describe("the deck reports its own exhaustion (#1931)", () => {
  // The credits now END, and the trigger for the ending is THIS: the bag has
  // dealt every set once. Not a pass counter and not a timer — both of those
  // would be a second tally that can disagree with what the reader has
  // actually been shown, which is the one thing the ending must not get wrong.

  it("is not exhausted before it has dealt anything", () => {
    // A fresh bag is empty in the same sense a dealt-out one is — the refill
    // is lazy — so "the bag array is empty" alone cannot be the reading. This
    // is the case that separates the two.
    expect(createProseDeck().exhausted()).toBe(false);
  });

  it("stays unexhausted while sets are still to come", () => {
    const deck = createProseDeck();
    for (let i = 0; i < CREDITS_PROSE.length - 1; i += 1) {
      deck.draw();
      expect(deck.exhausted(), `after draw ${i + 1}`).toBe(false);
    }
  });

  it("reports exhaustion exactly once per full bag", () => {
    // Twice through the pool: the reading must go true on the draw that empties
    // the bag and false again on the next one, which is the refill. A reading
    // that latched would send every later pass to the ending.
    const deck = createProseDeck();
    const draws = CREDITS_PROSE.length * 2;
    const exhaustedAt: number[] = [];
    for (let i = 1; i <= draws; i += 1) {
      deck.draw();
      if (deck.exhausted()) exhaustedAt.push(i);
    }
    expect(exhaustedAt).toEqual([CREDITS_PROSE.length, CREDITS_PROSE.length * 2]);
  });

  it("counts the whole pool, not a lucky early repeat", () => {
    // The property the ending depends on: when it reports exhausted, EVERY set
    // has been on screen. Asserted by collecting them rather than by counting.
    const deck = createProseDeck();
    const seen = new Set<string>();
    let draws = 0;
    while (!deck.exhausted() && draws <= CREDITS_PROSE.length) {
      const set = deck.draw();
      if (set !== null) seen.add(set.title);
      draws += 1;
    }
    expect(deck.exhausted()).toBe(true);
    expect(seen.size).toBe(CREDITS_PROSE.length);
  });

  it("is exhausted by its one set when that is all it has", () => {
    const deck = createProseDeck([{ title: "only", paragraphs: ["only"] }]);
    expect(deck.exhausted()).toBe(false);
    deck.draw();
    expect(deck.exhausted()).toBe(true);
  });

  it("an empty pool is never exhausted, because it has nothing to deal", () => {
    // The failure this forbids is the loud one: a pool filtered down to
    // nothing would otherwise read as "everything has been shown" on the very
    // first pass and cut straight to the ending.
    const deck = createProseDeck([]);
    expect(deck.exhausted()).toBe(false);
    deck.draw();
    deck.draw();
    expect(deck.exhausted()).toBe(false);
  });
});
