import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreditsModal from "../CreditsModal";
import type { BuildCredits } from "../lib/buildCredits";
import { CREDITS_SPECIAL_THANKS } from "../lib/creditsBlock";
import {
  CREDITS_FINALE_LINE,
  CREDITS_HEART,
  CREDITS_MANIFESTO_ATTRIBUTION,
} from "../lib/creditsFinale";
import {
  closeCreditsModal,
  creditsModalOpen,
  creditsMuted,
  openCreditsModal,
  toggleCreditsMuted,
} from "../lib/creditsModal";
import { CREDITS_PROSE } from "../lib/creditsProse";
import { __resetForTest, overlayCount, runTopmostOverlayEscape } from "../lib/overlayScrollLock";

// #1773 — the credits easter egg.
//
// The BAKE is the e2e's job (it compares what this paints against the exact
// payload the wrapper derived). What is proven here is everything that is
// true regardless of which payload arrives: that the roll renders the facts
// it is given, that it says so honestly when it is given none, that it holds
// a COVERING overlay lock rather than a bare escape hook, and that closing it
// leaves no audio graph behind.

const state = vi.hoisted(() => ({
  credits: { sha: null, date: null, contributors: [] } as BuildCredits,
}));

vi.mock("../lib/buildCredits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/buildCredits")>();
  return { ...actual, buildCredits: () => state.credits };
});

vi.mock("../lib/bundleHash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/bundleHash")>();
  return { ...actual, bootBundleVersionAccessor: () => "9.9.9" };
});

// jsdom has no WebAudio. A stub that records `close()` is enough for the one
// question this file asks of the audio: does the graph outlive the modal.
const audioContexts: { closed: boolean }[] = [];

class StubAudioContext {
  readonly state = "running";
  readonly destination = {};
  private readonly record: { closed: boolean };

  constructor() {
    this.record = { closed: false };
    audioContexts.push(this.record);
  }

  resume(): void {}
  close(): void {
    this.record.closed = true;
  }
  createGain() {
    return {
      gain: {
        value: 0,
        setValueAtTime: (): void => {},
        exponentialRampToValueAtTime: (): void => {},
        setTargetAtTime: (): void => {},
        // #1931 — the crossfade's verbs. This stub exists to let the modal's
        // lifecycle run, so it models whatever the real `AudioParam` has that
        // `creditsAudio` reaches for; the crossfade's BEHAVIOUR is measured in
        // `creditsAudio.test.ts`, against the stub that records calls.
        linearRampToValueAtTime: (): void => {},
        cancelScheduledValues: (): void => {},
      },
      connect: (): void => {},
      disconnect: (): void => {},
    };
  }
  createOscillator() {
    return {
      type: "",
      frequency: { value: 0, setValueAtTime: (): void => {} },
      connect: (): void => {},
      disconnect: (): void => {},
      start: (): void => {},
      stop: (): void => {},
      onended: null,
    };
  }
}

const POPULATED: BuildCredits = {
  sha: "a453325e",
  date: "2026-08-25T23:15:06+02:00",
  contributors: [
    { name: "Marcello Barnaba", nick: "vjt", commits: 5102 },
    { name: "Stefy Lanza", nick: "nextime", commits: 147 },
    // The two degenerate rows of #1927: a handle that IS the name, and a
    // contributor missing from the nick table entirely. Both render bare.
    { name: "Lucy", nick: "Lucy", commits: 26 },
    { name: "Ada Lovelace", nick: null, commits: 3 },
  ],
};

describe("CreditsModal (#1773)", () => {
  beforeEach(() => {
    state.credits = POPULATED;
    audioContexts.length = 0;
    vi.stubGlobal("AudioContext", StubAudioContext);
    // MatrixRain's dependencies; its own behaviour is MatrixRain.test.tsx's.
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  });

  afterEach(() => {
    closeCreditsModal();
    // The mute preference is session-scoped by design, so it survives a
    // close — which means it also survives into the next test unless a case
    // that flipped it puts it back.
    if (creditsMuted()) toggleCreditsMuted();
    __resetForTest();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders nothing and builds no audio graph while closed", () => {
    // Mounted in Shell for the whole session, so "closed" is its normal
    // state: a context constructed at mount would exist from boot, before any
    // gesture, and outlive every close.
    render(() => <CreditsModal />);

    expect(screen.queryByTestId("credits-modal")).toBeNull();
    expect(audioContexts).toHaveLength(0);
  });

  it("rolls the version, the build and every contributor with their count", () => {
    render(() => <CreditsModal />);
    openCreditsModal();

    expect(screen.getByTestId("credits-title").textContent).toBe("GRAPPA IRC");
    // The version comes from the bundle meta (#292), NOT from the credits
    // payload — one carrier per fact.
    expect(screen.getByTestId("credits-version").textContent).toBe("9.9.9");
    expect(screen.getByTestId("credits-sha").textContent).toBe("a453325e");
    // The bare ISO day git wrote, not a locale rendering.
    expect(screen.getByTestId("credits-date").textContent).toBe("2026-08-25");

    const people = screen.getAllByTestId("credits-person");
    expect(people).toHaveLength(4);
    // Handle first, real name as an italic parenthetical (#1927).
    expect(people[0]?.querySelector(".credits-person-name")?.textContent).toBe(
      "vjt (Marcello Barnaba)",
    );
    expect(people[0]?.querySelector("em.credits-person-realname")?.textContent).toBe(
      "Marcello Barnaba",
    );
    // The COUNT, not just the name: a roll that lists everyone with no
    // numbers is the same DOM shape and a different feature.
    expect(people[0]?.textContent).toContain("5102");
    expect(people[1]?.querySelector(".credits-person-name")?.textContent).toBe(
      "nextime (Stefy Lanza)",
    );
    expect(people[1]?.textContent).toContain("147");

    // Nick equal to the name, and no nick at all: one identifier, no
    // parentheses, nothing in italics. "Lucy (Lucy)" is the bug this asserts
    // against.
    expect(people[2]?.querySelector(".credits-person-name")?.textContent).toBe("Lucy");
    expect(people[2]?.querySelector("em")).toBeNull();
    expect(people[3]?.querySelector(".credits-person-name")?.textContent).toBe("Ada Lovelace");
    expect(people[3]?.querySelector("em")).toBeNull();
  });

  // #1929 — the roll, the cow and the special thanks are ONE block, the first
  // one, and the prose sets begin only after it has gone.
  //
  // The event IS the turn. It used to need a `getAnimations` stub as well,
  // because the modal read the pass off the animation and jsdom has none; the
  // modal now COUNTS these events instead, so dispatching one is the whole
  // gesture. The fade itself is CSS and belongs to `creditsRain.test.ts`,
  // which reads the stylesheet.
  const turnTheRollOver = (): void => {
    screen
      .getByTestId("credits-roll")
      .dispatchEvent(new Event("animationiteration", { bubbles: true }));
  };

  it("shows the cow and every dictated thanks inside the first block", () => {
    render(() => <CreditsModal />);
    openCreditsModal();

    // The cow is IN the block, not beside it: the block is what fades, so
    // anything outside it would survive the dissolve and sit on the rain.
    const block = screen.getByTestId("credits-block");
    expect(block.contains(screen.getByTestId("credits-cow"))).toBe(true);
    // Dictated verbatim, lowercase, on two balloon lines (vjt, 2026-09-06).
    const cow = screen.getByTestId("credits-cow").textContent ?? "";
    expect(cow).toContain("this grappa server");
    expect(cow).toContain("has super cow powers");

    // Every line, not a sample: the list is dictated, so a render that drops
    // one is the failure mode worth catching.
    const thanks = screen.getAllByTestId("credits-thanks");
    expect(thanks).toHaveLength(CREDITS_SPECIAL_THANKS.length);
    for (const entry of CREDITS_SPECIAL_THANKS) {
      expect(thanks.some((line) => line.textContent?.includes(entry.who))).toBe(true);
      expect(thanks.some((line) => line.textContent?.includes(entry.why))).toBe(true);
    }
  });

  it("carries no prose during the first block, and nothing but prose after it", () => {
    // The seam #1929 asked for, as an outcome rather than as a timing: on the
    // first pass the block is alone, and once the roll comes round the block
    // is gone and a paragraph set has taken its place.
    render(() => <CreditsModal />);
    openCreditsModal();

    expect(screen.getByTestId("credits-block")).toBeTruthy();
    expect(screen.queryByTestId("credits-prose")).toBeNull();

    turnTheRollOver();

    expect(screen.queryByTestId("credits-block")).toBeNull();
    expect(screen.queryByTestId("credits-cow")).toBeNull();
    expect(screen.queryAllByTestId("credits-thanks")).toHaveLength(0);
    expect(screen.getByTestId("credits-prose")).toBeTruthy();
  });

  it("says the build carries no history rather than rolling an empty list", () => {
    // What the AUR source tarball and the release image produce: both build
    // with no `.git`, by construction. A blank panel there reads as a broken
    // modal; this reads as the truth about the build.
    state.credits = { sha: null, date: null, contributors: [] };
    render(() => <CreditsModal />);
    openCreditsModal();

    expect(screen.getByTestId("credits-empty")).toBeTruthy();
    expect(screen.getByTestId("credits-sha").textContent).toBe("no build sha");
    expect(screen.queryByTestId("credits-date")).toBeNull();
    expect(screen.queryAllByTestId("credits-person")).toHaveLength(0);
  });

  it("holds a covering overlay lock while open, and releases it on close", async () => {
    // The #1772 lesson, as a test rather than a comment: this covers the
    // whole viewport, so it must take the scroll-lock REFCOUNT
    // (createOverlayLock) and not merely the escape hook
    // (createOverlayEscape) — without the refcount the iOS shell pans behind
    // it. The count is the only observable difference between the two.
    render(() => <CreditsModal />);
    openCreditsModal();

    await waitFor(() => {
      expect(overlayCount()).toBe(1);
    });

    closeCreditsModal();
    expect(overlayCount()).toBe(0);
  });

  it("closes on Escape through the shared topmost-overlay stack", async () => {
    render(() => <CreditsModal />);
    openCreditsModal();
    await waitFor(() => {
      expect(overlayCount()).toBe(1);
    });

    // Not a private keydown listener: membership of the ONE ordered stack is
    // what makes a modal opened over something else close first.
    expect(runTopmostOverlayEscape()).toBe(true);
    expect(screen.queryByTestId("credits-modal")).toBeNull();
  });

  it("tears the audio graph down when it closes", () => {
    render(() => <CreditsModal />);
    openCreditsModal();
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0]?.closed).toBe(false);

    fireEvent.click(screen.getByTestId("credits-close"));

    expect(screen.queryByTestId("credits-modal")).toBeNull();
    // A live context behind a dismissed dialog is silent and permanent —
    // exactly the shape of the rAF leak, and just as invisible.
    expect(audioContexts[0]?.closed).toBe(true);
  });

  it("offers a mute the reader can reach, and remembers it across a reopen", () => {
    render(() => <CreditsModal />);
    openCreditsModal();

    const mute = screen.getByTestId("credits-mute");
    expect(mute.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(mute);
    expect(screen.getByTestId("credits-mute").getAttribute("aria-pressed")).toBe("true");

    // Session-scoped, not persisted: it survives a close within the session,
    // which is the case that actually annoys, and does not end up in the
    // operator's saved preferences.
    closeCreditsModal();
    openCreditsModal();
    expect(screen.getByTestId("credits-mute").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the credits END (#1931)", () => {
  // The sequence vjt dictated, end to end: block → prose until the deck is
  // spent → manifesto → the credits again with a heart, a line and a button.
  //
  // jsdom has no `getAnimations`, so the roll would read every pass as the
  // first and no turnover could be observed. Stubbing it is what makes the
  // sequence reachable here at all; the stopping of the roll and the pulse are
  // CSS and belong to `creditsFinaleCss.test.ts`.
  const turnTheRollOver = (times: number): void => {
    const roll = screen.getByTestId("credits-roll");
    for (let i = 0; i < times; i += 1) {
      roll.dispatchEvent(new Event("animationiteration", { bubbles: true }));
    }
  };

  /** Turn it over until the ending is up, or give up loudly. */
  const runToTheEnd = (): number => {
    const ceiling = CREDITS_PROSE.length + 4;
    for (let turns = 1; turns <= ceiling; turns += 1) {
      turnTheRollOver(1);
      if (screen.queryByTestId("credits-heart") !== null) return turns;
    }
    throw new Error(`the ending never arrived in ${ceiling} turns`);
  };

  it("shows no ending until every set has been dealt", () => {
    // 🔴 The failure mode that would ruin the whole thing: an early "that's
    // all, folks". Asserted on EVERY turn up to the last set rather than on a
    // sample, because the interesting bug is an off-by-one.
    render(() => <CreditsModal />);
    openCreditsModal();

    for (let turn = 1; turn <= CREDITS_PROSE.length; turn += 1) {
      turnTheRollOver(1);
      expect(screen.queryByTestId("credits-heart"), `heart on turn ${turn}`).toBeNull();
      expect(screen.queryByTestId("credits-close-cta"), `button on turn ${turn}`).toBeNull();
    }
  });

  it("puts the manifesto between the last set and the ending", () => {
    render(() => <CreditsModal />);
    openCreditsModal();

    // The turn after the last set is the manifesto, and it is alone there.
    turnTheRollOver(CREDITS_PROSE.length + 1);
    expect(screen.getByTestId("credits-manifesto")).toBeTruthy();
    expect(screen.queryByTestId("credits-prose")).toBeNull();
    expect(screen.queryByTestId("credits-heart")).toBeNull();

    // ...and the turn after THAT is the ending, with the manifesto gone.
    turnTheRollOver(1);
    expect(screen.queryByTestId("credits-manifesto")).toBeNull();
    expect(screen.getByTestId("credits-heart")).toBeTruthy();
  });

  it("ships the manifesto's attribution with it, never bare", () => {
    // The credit is the condition on which the text is here at all, so it is
    // asserted at the RENDER and not only at the constant: a slot that shows
    // the words without the credit is the failure, and only this level sees it.
    render(() => <CreditsModal />);
    openCreditsModal();
    turnTheRollOver(CREDITS_PROSE.length + 1);

    const credit = screen.getByTestId("credits-manifesto-credit");
    expect(screen.getByTestId("credits-manifesto").contains(credit)).toBe(true);
    expect(credit.textContent).toBe(CREDITS_MANIFESTO_ATTRIBUTION);
  });

  it("brings the credits back for the ending, with the heart, the line and the button", () => {
    render(() => <CreditsModal />);
    openCreditsModal();
    runToTheEnd();

    // "the credits come back": the same block, not a new screen.
    const block = screen.getByTestId("credits-block");
    expect(screen.getByTestId("credits-title")).toBeTruthy();
    expect(block.contains(screen.getByTestId("credits-cow"))).toBe(true);
    expect(block.contains(screen.getByTestId("credits-heart"))).toBe(true);
    expect(screen.getByTestId("credits-heart").textContent).toBe(CREDITS_HEART);
    expect(screen.getByTestId("credits-finale-line").textContent).toBe(CREDITS_FINALE_LINE);
    expect(screen.getByTestId("credits-close-cta")).toBeTruthy();
  });

  it("does not re-arm the fade on the block that came back", () => {
    // The fade is `1 forwards`. A re-mounted block still carrying its class
    // would dissolve the ending as it arrives — invisible in review, and
    // fatal to the one screen the reader is meant to act on.
    render(() => <CreditsModal />);
    openCreditsModal();
    expect(screen.getByTestId("credits-block").classList.contains("credits-block-fading")).toBe(
      true,
    );

    runToTheEnd();

    expect(screen.getByTestId("credits-block").classList.contains("credits-block-fading")).toBe(
      false,
    );
  });

  it("stops the roll once the ending is up, so the button stays reachable", () => {
    render(() => <CreditsModal />);
    openCreditsModal();
    runToTheEnd();

    expect(screen.getByTestId("credits-roll").classList.contains("credits-roll-ended")).toBe(true);
  });

  it("closes through the same path everything else closes through", () => {
    // Not "the modal disappears": the assertion is on `creditsModalOpen`, the
    // signal `createOverlayLock` and the ✕ both drive. A second closing
    // mechanism is a second place for the scroll-lock refcount to go wrong.
    render(() => <CreditsModal />);
    openCreditsModal();
    runToTheEnd();

    fireEvent.click(screen.getByTestId("credits-close-cta"));

    expect(creditsModalOpen()).toBe(false);
    expect(screen.queryByTestId("credits-modal")).toBeNull();
  });

  it("holds on the ending rather than looping back round", () => {
    render(() => <CreditsModal />);
    openCreditsModal();
    runToTheEnd();

    turnTheRollOver(3);

    expect(screen.getByTestId("credits-heart")).toBeTruthy();
    expect(screen.queryByTestId("credits-prose")).toBeNull();
  });

  it("reaches the ending ACROSS several viewings, because the deck is the session's", () => {
    // vjt's intent, and the reason the deck is not rebuilt per open: someone
    // who watches a few sets, closes, and comes back should be closer to the
    // end, not back at the start. Closing one turn short and reopening must
    // therefore land on the ending rather than deal a seventeenth set.
    render(() => <CreditsModal />);
    openCreditsModal();
    turnTheRollOver(CREDITS_PROSE.length);
    expect(screen.queryByTestId("credits-manifesto")).toBeNull();

    closeCreditsModal();
    openCreditsModal();

    // The block again — a fresh opening always opens on the credits...
    expect(screen.getByTestId("credits-block")).toBeTruthy();
    expect(screen.queryByTestId("credits-heart")).toBeNull();
    // ...and then straight into the ending, because the bag is still spent.
    turnTheRollOver(1);
    expect(screen.getByTestId("credits-manifesto")).toBeTruthy();
    turnTheRollOver(1);
    expect(screen.getByTestId("credits-heart")).toBeTruthy();
  });

  it("starts a fresh run on the opening AFTER a finished one", () => {
    // The other side of the same rule, and the one a latch gets wrong: once
    // the ending has run, the sequence is over — reopening deals prose again
    // rather than replaying the ending for ever, which would make sixteen sets
    // unreachable for the rest of the session.
    render(() => <CreditsModal />);
    openCreditsModal();
    runToTheEnd();

    closeCreditsModal();
    openCreditsModal();
    turnTheRollOver(1);

    expect(screen.getByTestId("credits-prose")).toBeTruthy();
    expect(screen.queryByTestId("credits-heart")).toBeNull();
    expect(screen.queryByTestId("credits-manifesto")).toBeNull();
  });
});
