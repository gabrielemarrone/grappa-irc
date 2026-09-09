import { createEffect, createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #2029 — "strip mIRC formatting" display preference. Boolean, OFF by default:
// colours render exactly as they do today until a reader opts out of them.
//
// It takes colorNicklist.ts's SHAPE (module-singleton signal + localStorage
// write-through) because the flag is read at RENDER time by `MircBody`, and
// its POSTURE (one of the #449 server-backed prefs, PUT by `displayPrefs.ts`)
// because the complaint behind it — a channel full of coloured bot output — is
// account-scoped, not viewport-scoped like #914's per-device sibling.
//
// The default is OFF, so `v === "true"` carries both jobs (parse the stored
// value, and fall back to the default on garbage) — the coincidence
// showBottomBar.ts had to break with an inverted default. Pinned anyway: it is
// a coincidence, not a design, and the next default flip needs it stated.

describe("stripFormatting module", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  describe("getStripFormatting()", () => {
    it("defaults to FALSE when localStorage is empty — colours keep rendering", async () => {
      const { getStripFormatting } = await import("../lib/stripFormatting");
      expect(getStripFormatting()).toBe(false);
    });

    it("returns true when localStorage holds 'true'", async () => {
      localStorage.setItem("cicchetto.stripFormatting", "true");
      const { getStripFormatting } = await import("../lib/stripFormatting");
      expect(getStripFormatting()).toBe(true);
    });

    it("returns false when localStorage holds 'false'", async () => {
      localStorage.setItem("cicchetto.stripFormatting", "false");
      const { getStripFormatting } = await import("../lib/stripFormatting");
      expect(getStripFormatting()).toBe(false);
    });

    it("falls back to FALSE when localStorage holds an unparseable value", async () => {
      localStorage.setItem("cicchetto.stripFormatting", "1");
      const { getStripFormatting } = await import("../lib/stripFormatting");
      expect(getStripFormatting()).toBe(false);
    });
  });

  describe("setStripFormatting()", () => {
    it("persists 'true' to localStorage when stripping", async () => {
      const { setStripFormatting } = await import("../lib/stripFormatting");
      setStripFormatting(true);
      expect(localStorage.getItem("cicchetto.stripFormatting")).toBe("true");
    });

    it("persists 'false' to localStorage when not stripping", async () => {
      const { setStripFormatting } = await import("../lib/stripFormatting");
      setStripFormatting(false);
      expect(localStorage.getItem("cicchetto.stripFormatting")).toBe("false");
    });

    // The assertion that constrains the SHAPE, and the one the issue's own
    // wording depends on. A plain `localStorage.getItem` getter passes every
    // test above — including a set-then-get round trip — while leaving every
    // OPEN pane rendering its old colours until a reload. "Toggling it back
    // must restore colours without a reconnect" is only true of a TRACKED
    // read: the effect must re-run.
    it("re-runs a tracked read, so an open pane re-renders on toggle", async () => {
      const { getStripFormatting, setStripFormatting } = await import("../lib/stripFormatting");
      const seen: boolean[] = [];
      createRoot(() => {
        createEffect(() => seen.push(getStripFormatting()));
      });
      await Promise.resolve();
      expect(seen).toEqual([false]);

      setStripFormatting(true);
      await Promise.resolve();
      expect(seen).toEqual([false, true]);

      setStripFormatting(false);
      await Promise.resolve();
      expect(seen).toEqual([false, true, false]);
    });
  });
});
