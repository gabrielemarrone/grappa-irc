import { render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The four accessors are module-init constants in a real browser (`<script
// src>` and `<meta>` are read once), and jsdom has neither tag — so the boot
// side is permanently null here unless it is stubbed. Same seam and same
// reason as `Toasts.test.tsx`, which stubs the same two boot accessors.
//
// `importOriginal` is spread so `bundleSkew` stays the REAL function: it is
// the pure verdict under test, and mocking it would leave the readout's
// aligned/skewed/unknown line asserting only against itself.
const bundle = vi.hoisted(() => ({
  bootHash: null as string | null,
  bootVersion: null as string | null,
  serverHash: null as string | null,
  serverVersion: null as string | null,
}));

vi.mock("../lib/bundleHash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/bundleHash")>()),
  bootBundleHashAccessor: () => bundle.bootHash,
  bootBundleVersionAccessor: () => bundle.bootVersion,
  serverBundleHash: () => bundle.serverHash,
  serverBundleVersion: () => bundle.serverVersion,
}));

import BundleReadout from "../BundleReadout";

// Real vite output shape, measured on `cicchetto/dist/index.html`:
// `/assets/index-DyH3fZLf.js` — an EIGHT-character hash. The fixtures below
// keep that width on purpose; the truncation assertion depends on it.
const BOOT_HASH = "DyH3fZLf";
const SERVER_HASH = "Ab12Cd34";

const text = (testId: string): string => screen.getByTestId(testId).textContent?.trim() ?? "";

describe("BundleReadout (issue 1974 — running bundle vs deployed bundle)", () => {
  beforeEach(() => {
    bundle.bootHash = null;
    bundle.bootVersion = null;
    bundle.serverHash = null;
    bundle.serverVersion = null;
  });

  it("renders all FOUR facts — boot version+hash and server version+hash — side by side", () => {
    bundle.bootHash = BOOT_HASH;
    bundle.bootVersion = "0.16.0";
    bundle.serverHash = SERVER_HASH;
    bundle.serverVersion = "0.16.1";
    render(() => <BundleReadout />);

    // The whole point of the issue: four values, in one place, at once.
    // Asserted per cell rather than on the section's concatenated text, so a
    // regression that drops one side cannot hide behind the other three.
    expect(text("settings-build-running-version")).toBe("0.16.0");
    expect(text("settings-build-running-hash")).toBe(BOOT_HASH);
    expect(text("settings-build-deployed-version")).toBe("0.16.1");
    expect(text("settings-build-deployed-hash")).toBe(SERVER_HASH);
  });

  it("prints the build hash WHOLE, not the banner's 7-char short form", () => {
    // `versionLabel`/`formatRefreshBanner` truncate to SHORT_HASH_LEN = 7 so a
    // sentence stays readable. A readout exists to be COMPARED against another
    // hash, and vite's hash is 8 characters — reusing that formatter here
    // would silently drop the last one of the two values being compared.
    bundle.bootHash = BOOT_HASH;
    bundle.serverHash = SERVER_HASH;
    render(() => <BundleReadout />);

    expect(text("settings-build-running-hash")).toHaveLength(BOOT_HASH.length);
    expect(text("settings-build-deployed-hash")).toHaveLength(SERVER_HASH.length);
  });

  it("reads 'aligned' when the two hashes agree", () => {
    bundle.bootHash = BOOT_HASH;
    bundle.serverHash = BOOT_HASH;
    render(() => <BundleReadout />);

    expect(screen.getByTestId("settings-build").getAttribute("data-skew")).toBe("aligned");
    expect(text("settings-build-skew").length).toBeGreaterThan(0);
  });

  it("reads 'skewed' when the two hashes disagree (the stale-bundle case)", () => {
    bundle.bootHash = BOOT_HASH;
    bundle.serverHash = SERVER_HASH;
    render(() => <BundleReadout />);

    expect(screen.getByTestId("settings-build").getAttribute("data-skew")).toBe("skewed");
  });

  it("reads 'unknown' before the server has announced a build — NOT 'aligned'", () => {
    // The third state is load-bearing: until the user-topic join lands its
    // `bundle_hash`, nothing has been compared. Painting that as "up to date"
    // would state a fact nobody measured, which is the failure the readout
    // exists to stop.
    bundle.bootHash = BOOT_HASH;
    bundle.serverHash = null;
    render(() => <BundleReadout />);

    expect(screen.getByTestId("settings-build").getAttribute("data-skew")).toBe("unknown");
  });

  it("degrades an unknown cell to a word, never to a blank", () => {
    // A build genuinely can carry no semver (a bundle built before #292, or a
    // server that omits the wire key), and an empty cell reads as a broken
    // readout rather than as the truth about the build — the same posture
    // CreditsModal takes with "version unknown".
    bundle.bootHash = BOOT_HASH;
    bundle.bootVersion = null;
    bundle.serverHash = null;
    bundle.serverVersion = null;
    render(() => <BundleReadout />);

    expect(text("settings-build-running-version")).toBe("unknown");
    expect(text("settings-build-deployed-version")).toBe("unknown");
    expect(text("settings-build-deployed-hash")).toBe("unknown");
    // The one fact we DO have still shows — a degraded neighbour must not
    // blank the cell that is known.
    expect(text("settings-build-running-hash")).toBe(BOOT_HASH);
  });
});
