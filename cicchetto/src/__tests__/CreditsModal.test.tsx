import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreditsModal from "../CreditsModal";
import type { BuildCredits } from "../lib/buildCredits";
import { CREDITS_SPECIAL_THANKS } from "../lib/creditsBlock";
import {
  closeCreditsModal,
  creditsMuted,
  openCreditsModal,
  toggleCreditsMuted,
} from "../lib/creditsModal";
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
  // `getAnimations` is absent in jsdom, so `creditsRollPass` would read every
  // pass as the first and the swap could never be observed. Stubbing it on the
  // roll is what makes the SECOND pass reachable here at all; the fade itself
  // is CSS and belongs to `creditsRain.test.ts`, which reads the stylesheet.
  const turnTheRollOver = (): void => {
    const roll = screen.getByTestId("credits-roll");
    Object.defineProperty(roll, "getAnimations", {
      configurable: true,
      value: () => [{ effect: { getComputedTiming: () => ({ currentIteration: 1 }) } }],
    });
    roll.dispatchEvent(new Event("animationiteration", { bubbles: true }));
  };

  it("shows the cow and every dictated thanks inside the first block", () => {
    render(() => <CreditsModal />);
    openCreditsModal();

    // The cow is IN the block, not beside it: the block is what fades, so
    // anything outside it would survive the dissolve and sit on the rain.
    const block = screen.getByTestId("credits-block");
    expect(block.contains(screen.getByTestId("credits-cow"))).toBe(true);
    expect(screen.getByTestId("credits-cow").textContent).toContain("Super Cow Powers");

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
