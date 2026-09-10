import { beforeEach, describe, expect, it, vi } from "vitest";

// pseudoChannelsForNetwork — the ONE shared projection (extracted from
// Sidebar, #71 INC-3) that derives synthetic non-joined window rows from
// windowStateByChannel. Characterizes the behavior locked by the
// pre-existing Sidebar.test.tsx suite at its new home.
//
// #902 — `invited` is deliberately NOT among the drawn states any more: an
// unanswered invite is announced by the stacked top banner
// (`lib/errorBanners.ts`), not by a greyed row. The exclusion is asserted
// below rather than merely omitted, because the `:invited` key is still a
// normal thing to find in the state map — the server still holds the window
// — so "no row" has to be a decision this projection makes, not an accident
// of never being handed one.
//
// Boundary mocks: the three reactive stores the projection reads. The
// channelKey / decodeChannelKey codec is the REAL pure function — keys
// are built via `channelKey(...)` so the test never re-implements the
// composite-key shape (CLAUDE.md "use production code in tests").

const state = vi.hoisted(() => ({
  ws: {} as Record<string, string>,
  cbs: undefined as Record<string, { name: string; joined: boolean }[]> | undefined,
  qw: {} as Record<number, { targetNick: string }[]>,
  mobile: false,
  // issue 1985 — the network's own state, read through the REAL
  // `isNetworkParked`: this suite mocks `lib/networks` (a resource
  // singleton) but never the predicate, so the rule under test is the
  // shipped one and not a mirror of itself.
  connectionState: "connected" as string,
}));

vi.mock("../lib/windowState", () => ({ windowStateByChannel: () => state.ws }));
vi.mock("../lib/networks", () => ({
  // #1861 — casemappingForSlug (lib/casemapping.ts) resolves the fold
  // through this map, so the mock has to carry it.
  networkIdBySlug: () => undefined,
  channelsBySlug: () => state.cbs,
  networkBySlug: (slug: string) =>
    slug === "freenode"
      ? { kind: "user", id: 1, slug, connection_state: state.connectionState }
      : undefined,
}));
vi.mock("../lib/queryWindows", () => ({ queryWindowsByNetwork: () => state.qw }));
// The form factor is an environment boundary (matchMedia); mocking the
// signal is what lets one jsdom run exercise both navs.
vi.mock("../lib/theme", () => ({ isMobile: () => state.mobile }));

import { channelKey } from "../lib/channelKey";
import { navPseudoChannelsForNetwork, pseudoChannelsForNetwork } from "../lib/pseudoChannels";

beforeEach(() => {
  state.ws = {};
  state.cbs = {};
  state.qw = {};
  state.mobile = false;
  state.connectionState = "connected";
});

describe("pseudoChannelsForNetwork", () => {
  it("returns a row for every DRAWN non-joined state (pending/failed/kicked/parked)", () => {
    state.ws = {
      [channelKey("freenode", "#pending")]: "pending",
      [channelKey("freenode", "#failed")]: "failed",
      [channelKey("freenode", "#kicked")]: "kicked",
      [channelKey("freenode", "#parked")]: "parked",
    };
    const rows = pseudoChannelsForNetwork("freenode", 1);
    expect(rows).toEqual(
      expect.arrayContaining([
        { name: "#pending", state: "pending" },
        { name: "#failed", state: "failed" },
        { name: "#kicked", state: "kicked" },
        { name: "#parked", state: "parked" },
      ]),
    );
    expect(rows.length).toBe(4);
  });

  // #902 — the banner owns this state. A row here would be the "second place
  // to look" the issue exists to remove.
  it("excludes :invited windows even though the state map still carries them", () => {
    state.ws = {
      [channelKey("freenode", "#invited")]: "invited",
      [channelKey("freenode", "#failed")]: "failed",
    };
    expect(pseudoChannelsForNetwork("freenode", 1)).toEqual([{ name: "#failed", state: "failed" }]);
  });

  it("excludes joined windows (channelsBySlug branch owns them)", () => {
    state.ws = {
      [channelKey("freenode", "#joined")]: "joined",
      [channelKey("freenode", "#failed")]: "failed",
    };
    const rows = pseudoChannelsForNetwork("freenode", 1);
    expect(rows).toEqual([{ name: "#failed", state: "failed" }]);
  });

  it("dedups a key already live in channelsBySlug (the live row wins)", () => {
    state.ws = { [channelKey("freenode", "#dup")]: "kicked" };
    state.cbs = { freenode: [{ name: "#dup", joined: true }] };
    expect(pseudoChannelsForNetwork("freenode", 1)).toEqual([]);
  });

  it("excludes query (DM) targets that also carry a windowState entry", () => {
    state.ws = { [channelKey("freenode", "alice")]: "kicked" };
    state.qw = { 1: [{ targetNick: "alice" }] };
    expect(pseudoChannelsForNetwork("freenode", 1)).toEqual([]);
  });

  it("filters to the requested network slug (ignores other networks' keys)", () => {
    state.ws = {
      [channelKey("freenode", "#here")]: "failed",
      [channelKey("libera", "#there")]: "failed",
    };
    expect(pseudoChannelsForNetwork("freenode", 1)).toEqual([{ name: "#here", state: "failed" }]);
  });

  it("returns [] when no windowState entries exist", () => {
    expect(pseudoChannelsForNetwork("freenode", 1)).toEqual([]);
  });

  it("tolerates an undefined channelsBySlug (no live map yet)", () => {
    state.ws = { [channelKey("freenode", "#failed")]: "failed" };
    state.cbs = undefined;
    expect(pseudoChannelsForNetwork("freenode", 1)).toEqual([{ name: "#failed", state: "failed" }]);
  });
});

// #402 — the form-factor view. This is the set the navs render AND the set
// the archive filter subtracts, so the two cannot disagree about which
// window has a surface. The narrowing used to be open-coded in BottomBar,
// where the archive could not see it.
describe("navPseudoChannelsForNetwork", () => {
  const everyDrawnState = () => {
    state.ws = {
      [channelKey("freenode", "#pending")]: "pending",
      [channelKey("freenode", "#failed")]: "failed",
      [channelKey("freenode", "#kicked")]: "kicked",
      [channelKey("freenode", "#parked")]: "parked",
    };
  };

  it("draws every non-joined state on desktop (the Sidebar renders them all)", () => {
    everyDrawnState();
    state.mobile = false;
    expect(navPseudoChannelsForNetwork("freenode", 1)).toEqual(
      pseudoChannelsForNetwork("freenode", 1),
    );
    expect(navPseudoChannelsForNetwork("freenode", 1)).toHaveLength(4);
  });

  // #902 — the `:invited` slice was the BottomBar's ENTIRE pseudo-row
  // content, and the banner replaced it, so mobile draws nothing here. The
  // archive reads this same function, so it now subtracts nothing on mobile
  // and a pending/failed/kicked/parked window is reachable there through the
  // archive — #402's "one window, one surface" rule, applied to the new
  // surface map rather than excepted from it.
  it("draws NOTHING on mobile — there is no mobile pseudo-row nav any more", () => {
    everyDrawnState();
    state.mobile = true;
    expect(navPseudoChannelsForNetwork("freenode", 1)).toEqual([]);
  });

  it("draws nothing on mobile even for a lone invited window (the banner has it)", () => {
    state.ws = { [channelKey("freenode", "#invited")]: "invited" };
    state.mobile = true;
    expect(navPseudoChannelsForNetwork("freenode", 1)).toEqual([]);
  });

  // issue 1985 — the same #402 rule against the new surface map. A parked
  // network is dropped at the ONE `<For>` in `Sidebar.tsx`, so the desktop nav
  // draws none of its rows — pseudo-rows included, since they render INSIDE
  // that loop. The archive subtracts what this function returns, so leaving
  // the projection intact here would subtract rows nothing draws: one window,
  // ZERO surfaces, which is exactly the bug #402 was filed for.
  it("draws nothing for a parked network — the Sidebar no longer renders it at all", () => {
    everyDrawnState();
    state.mobile = false;
    state.connectionState = "parked";
    expect(navPseudoChannelsForNetwork("freenode", 1)).toEqual([]);
  });

  // The asymmetry is the product decision (CLAUDE.md #1675 / networkParked.ts):
  // a FAILED network keeps its greyed row in place, so its pseudo-rows are
  // still drawn and must still be subtracted. A "any non-connected state"
  // generalisation would silently turn this one.
  it("still draws a FAILED network's rows — that network keeps its greyed row", () => {
    everyDrawnState();
    state.mobile = false;
    state.connectionState = "failed";
    expect(navPseudoChannelsForNetwork("freenode", 1)).toHaveLength(4);
  });

  // Same for `failing` (#1675): it is retrying on its own and has a way back.
  it("still draws a FAILING network's rows", () => {
    everyDrawnState();
    state.mobile = false;
    state.connectionState = "failing";
    expect(navPseudoChannelsForNetwork("freenode", 1)).toHaveLength(4);
  });
});
