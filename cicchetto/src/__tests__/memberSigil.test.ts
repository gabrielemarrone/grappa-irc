import { describe, expect, it } from "vitest";

// issue 1999 — `memberSigil` used to hardcode `@ > % > +`. Once the server
// stopped gluing sigils to nicks (`ISupport.sigils/1` drives the 353 peel),
// a founder's `["~"]` matched none of the three branches and fell through to
// the plain arm: drawn with no sigil, indistinguishable from a lurker.
//
// The rank now comes from the network's own PREFIX, via `sigilRank`. These
// cases pin the pure function; the store hop (`sigilRankForNetwork` /
// `sigilRankForSlug`) is covered in isupport.test.ts and casemapping.test.ts.

import { DEFAULT_ISUPPORT, sigilRank } from "../lib/isupport";
import { memberSigil } from "../lib/memberSigil";

const BAHAMUT = sigilRank(DEFAULT_ISUPPORT);
const RICH = ["~", "&", "@", "%", "+"];

describe("memberSigil", () => {
  it("renders the single sigil a member holds", () => {
    expect(memberSigil(["@"], BAHAMUT)).toBe("@");
    expect(memberSigil(["%"], BAHAMUT)).toBe("%");
    expect(memberSigil(["+"], BAHAMUT)).toBe("+");
  });

  it("renders a space for a plain member — the column-alignment contract", () => {
    // Not `""`: the members pane is a monospace column and the space keeps
    // plain rows aligned with their sigil-bearing siblings. The `→ ""`
    // translation for NickText happens at the call sites.
    expect(memberSigil([], BAHAMUT)).toBe(" ");
  });

  it("picks the HIGHEST-ranked sigil a member holds", () => {
    expect(memberSigil(["+", "@"], BAHAMUT)).toBe("@");
    expect(memberSigil(["+", "%"], BAHAMUT)).toBe("%");
  });

  it("ranks founder and admin above op on a PREFIX-rich network", () => {
    // The reported case. `~` used to fall through to the plain arm.
    expect(memberSigil(["~"], RICH)).toBe("~");
    expect(memberSigil(["&"], RICH)).toBe("&");
    expect(memberSigil(["@", "~"], RICH)).toBe("~");
    expect(memberSigil(["+", "&"], RICH)).toBe("&");
  });

  it("takes rank from the RUN, not from the modes array's own order", () => {
    // A member accumulates sigils in whatever order MODE lines arrived; the
    // server prepends. Order in the array carries no rank information.
    expect(memberSigil(["@", "&", "+"], RICH)).toBe("&");
    expect(memberSigil(["+", "&", "@"], RICH)).toBe("&");
  });

  it("a sigil the network never advertised is not a grade", () => {
    // On a `(ov)@+` network a stray `~` names no level cic could describe,
    // so the member reads as plain rather than being handed an invented
    // glyph. Same posture `membershipLevelName` takes for an unknown sigil.
    expect(memberSigil(["~"], ["@", "+"])).toBe(" ");
  });

  it("an empty rank run yields plain rather than throwing", () => {
    expect(memberSigil(["@"], [])).toBe(" ");
  });
});
