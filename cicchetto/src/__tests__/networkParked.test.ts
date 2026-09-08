import { describe, expect, it } from "vitest";
import type { Network } from "../lib/api";
import { isNetworkParked } from "../lib/networkParked";

// issue 1985 — the predicate the ruling is written in. Both the Sidebar and
// Shell suites mock `lib/networks` wholesale (it is a resource singleton), so
// this is the one place the rule itself is measured rather than a call site's
// wiring to it.
//
// The `as unknown as Network` casts are the point of the file, not a
// shortcut: the closed set of `connection_state` values is
// `[connected, parked, failing, failed]` (CLAUDE.md, #1675), and the
// interesting inputs are the four states plus a visitor — a shape the
// discriminated union deliberately gives no `connection_state` at all. Naming
// each state through the type would only let the compiler restate what it
// already knows; what needs proving is which of them the predicate says yes
// to.
const userNet = (connection_state: string): Network =>
  ({
    kind: "user",
    id: 1,
    slug: "azzurra",
    nick: "vjt",
    connection_state,
    connection_state_reason: null,
    connection_state_changed_at: null,
    inserted_at: "",
    updated_at: "",
  }) as unknown as Network;

describe("issue 1985 — isNetworkParked", () => {
  it("says yes to a parked user network", () => {
    expect(isNetworkParked(userNet("parked"))).toBe(true);
  });

  // The three negatives are the whole asymmetry, one assertion each. A
  // generalisation to "any non-connected state" would turn two of them.
  it("says no to connected", () => {
    expect(isNetworkParked(userNet("connected"))).toBe(false);
  });

  it("says no to failed — a failure stays greyed in place for the operator to see", () => {
    expect(isNetworkParked(userNet("failed"))).toBe(false);
  });

  it("says no to failing — #1675, it is retrying on its own", () => {
    expect(isNetworkParked(userNet("failing"))).toBe(false);
  });

  it("says no to a VISITOR network even when the field reads parked", () => {
    // A visitor has no credential row to park, so the real wire shape carries
    // no `connection_state`. The value is planted anyway: if the `kind` narrow
    // were dropped, a visitor network would start disappearing from the
    // sidebar, and this is the input that catches it.
    const visitor = {
      kind: "visitor",
      id: 2,
      slug: "azzurra",
      nick: "guest",
      connection_state: "parked",
    } as unknown as Network;
    expect(isNetworkParked(visitor)).toBe(false);
  });

  it("says no to an absent network", () => {
    // Shell's cold-load gate calls this with `networkBySlug(slug)`, which is
    // `undefined` for a slug that is no longer bound. Not parked — the saved
    // window is unrestorable for a different reason, and the branches below
    // the gate are the ones that must decide it.
    expect(isNetworkParked(undefined)).toBe(false);
  });
});
