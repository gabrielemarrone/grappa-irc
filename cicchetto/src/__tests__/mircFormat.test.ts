import { describe, expect, it } from "vitest";
import { MIRC_PALETTE, mircPlainRuns, parseMircFormat } from "../lib/mircFormat";

// mIRC text formatting parser. Pinned at the per-Run output level: the
// test asserts the structure of the runs (text + flag set + resolved
// fg/bg CSS colors), NOT call sequences. Colors are resolved to CSS
// strings IN THE PARSER (palette index → hex, `\x04` hex → `#rrggbb`)
// so the renderer is a dumb applier — no palette lookup leaks into
// ScrollbackPane. Plain-text fast path is the most common case so it
// goes first.
describe("parseMircFormat", () => {
  describe("plain text fast path", () => {
    it("collapses no-formatting text into a single run", () => {
      const runs = parseMircFormat("hello world");
      expect(runs).toHaveLength(1);
      expect(runs[0]).toEqual({
        text: "hello world",
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        monospace: false,
        reverse: false,
      });
    });

    it("returns no runs for the empty string", () => {
      expect(parseMircFormat("")).toEqual([]);
    });

    it("treats CTCP \\x01 as plain text (the scrollback boundary handles framing)", () => {
      const runs = parseMircFormat("\x01ACTION waves\x01");
      expect(runs).toHaveLength(1);
      expect(runs[0]?.text).toBe("\x01ACTION waves\x01");
    });
  });

  describe("toggle codes", () => {
    it("\\x02 toggles bold and produces 2 runs around the marker", () => {
      const runs = parseMircFormat("a\x02b\x02c");
      expect(runs.map((r) => ({ text: r.text, bold: r.bold }))).toEqual([
        { text: "a", bold: false },
        { text: "b", bold: true },
        { text: "c", bold: false },
      ]);
    });

    it("\\x1d toggles italic", () => {
      const runs = parseMircFormat("\x1ditalic\x1dplain");
      expect(runs[0]?.italic).toBe(true);
      expect(runs[0]?.text).toBe("italic");
      expect(runs[1]?.italic).toBe(false);
      expect(runs[1]?.text).toBe("plain");
    });

    it("\\x1f toggles underline", () => {
      const runs = parseMircFormat("\x1funder\x1f");
      expect(runs).toHaveLength(1);
      expect(runs[0]?.underline).toBe(true);
      expect(runs[0]?.text).toBe("under");
    });

    it("\\x1e toggles strikethrough", () => {
      const runs = parseMircFormat("\x1egone\x1eback");
      expect(runs[0]?.strikethrough).toBe(true);
      expect(runs[0]?.text).toBe("gone");
      expect(runs[1]?.strikethrough).toBe(false);
      expect(runs[1]?.text).toBe("back");
    });

    it("\\x11 toggles monospace", () => {
      const runs = parseMircFormat("\x11code()\x11");
      expect(runs).toHaveLength(1);
      expect(runs[0]?.monospace).toBe(true);
      expect(runs[0]?.text).toBe("code()");
    });

    it("\\x16 toggles reverse", () => {
      const runs = parseMircFormat("\x16rev\x16");
      expect(runs[0]?.reverse).toBe(true);
      expect(runs[0]?.text).toBe("rev");
    });

    it("attribute-only stretches collapse — no empty-text runs", () => {
      // \x02\x02 toggles bold on then off with no text in between → no run emitted.
      const runs = parseMircFormat("a\x02\x02b");
      expect(runs).toHaveLength(2);
      expect(runs[0]?.text).toBe("a");
      expect(runs[1]?.text).toBe("b");
      expect(runs[1]?.bold).toBe(false);
    });

    it("\\x0f resets every toggle + colors", () => {
      const runs = parseMircFormat("\x02\x1d\x1e\x11\x033,5loud and red\x0fplain");
      const last = runs.at(-1);
      expect(last?.text).toBe("plain");
      expect(last?.bold).toBe(false);
      expect(last?.italic).toBe(false);
      expect(last?.strikethrough).toBe(false);
      expect(last?.monospace).toBe(false);
      expect(last?.fg).toBeUndefined();
      expect(last?.bg).toBeUndefined();
    });

    it("toggles compose — bold + italic + strike + mono on the same run", () => {
      const runs = parseMircFormat("\x02\x1d\x1e\x11all\x02\x1d\x1e\x11");
      expect(runs).toHaveLength(1);
      expect(runs[0]?.bold).toBe(true);
      expect(runs[0]?.italic).toBe(true);
      expect(runs[0]?.strikethrough).toBe(true);
      expect(runs[0]?.monospace).toBe(true);
    });
  });

  describe("\\x03 color codes", () => {
    it("\\x03N sets fg only, resolved to the palette CSS color", () => {
      const runs = parseMircFormat("\x034red");
      expect(runs[0]?.fg).toBe(MIRC_PALETTE[4]);
      expect(runs[0]?.bg).toBeUndefined();
      expect(runs[0]?.text).toBe("red");
    });

    it("\\x03N,M sets fg and bg", () => {
      const runs = parseMircFormat("\x034,8alarm");
      expect(runs[0]?.fg).toBe(MIRC_PALETTE[4]);
      expect(runs[0]?.bg).toBe(MIRC_PALETTE[8]);
      expect(runs[0]?.text).toBe("alarm");
    });

    it("two-digit color codes parse correctly (15)", () => {
      const runs = parseMircFormat("\x0315gray\x03plain");
      expect(runs[0]?.fg).toBe(MIRC_PALETTE[15]);
      expect(runs[1]?.fg).toBeUndefined();
    });

    it("resolves extended-palette codes 16-98 (no clamp)", () => {
      const runs = parseMircFormat("\x0352bright-red");
      expect(runs[0]?.fg).toBe(MIRC_PALETTE[52]);
      expect(runs[0]?.text).toBe("bright-red");
    });

    it("\\x0399 is the explicit default color (resets, does not clamp)", () => {
      const runs = parseMircFormat("\x034red\x0399def");
      expect(runs[0]?.fg).toBe(MIRC_PALETTE[4]);
      expect(runs[1]?.fg).toBeUndefined();
      expect(runs[1]?.text).toBe("def");
    });

    it("bare \\x03 resets colors but preserves toggles", () => {
      const runs = parseMircFormat("\x02\x034bold-red\x03still-bold");
      expect(runs).toHaveLength(2);
      expect(runs[0]?.bold).toBe(true);
      expect(runs[0]?.fg).toBe(MIRC_PALETTE[4]);
      expect(runs[1]?.bold).toBe(true);
      expect(runs[1]?.fg).toBeUndefined();
    });

    it("stray comma after a color stays as literal text when no bg digits follow", () => {
      // \x034,foo — fg=4, then ",foo" is plain because `f` isn't a digit.
      const runs = parseMircFormat("\x034,foo");
      expect(runs).toHaveLength(1);
      expect(runs[0]?.fg).toBe(MIRC_PALETTE[4]);
      expect(runs[0]?.bg).toBeUndefined();
      expect(runs[0]?.text).toBe(",foo");
    });

    it("color code with no digits at all is bare reset", () => {
      const runs = parseMircFormat("\x034red\x03plain");
      expect(runs[1]?.fg).toBeUndefined();
      expect(runs[1]?.text).toBe("plain");
    });
  });

  describe("\\x04 hex color codes", () => {
    it("\\x04RRGGBB sets fg to the literal hex color", () => {
      const runs = parseMircFormat("\x04ff0000red");
      expect(runs[0]?.fg).toBe("#ff0000");
      expect(runs[0]?.bg).toBeUndefined();
      expect(runs[0]?.text).toBe("red");
    });

    it("\\x04RRGGBB,RRGGBB sets fg and bg", () => {
      const runs = parseMircFormat("\x04FF0000,00FF00xmas");
      expect(runs[0]?.fg).toBe("#FF0000");
      expect(runs[0]?.bg).toBe("#00FF00");
      expect(runs[0]?.text).toBe("xmas");
    });

    it("bare \\x04 resets hex colors but preserves toggles", () => {
      const runs = parseMircFormat("\x02\x04abcdefbold-hex\x04still-bold");
      expect(runs).toHaveLength(2);
      expect(runs[0]?.bold).toBe(true);
      expect(runs[0]?.fg).toBe("#abcdef");
      expect(runs[1]?.bold).toBe(true);
      expect(runs[1]?.fg).toBeUndefined();
    });

    it("fewer than 6 hex digits is a bare reset; the partial digits stay as text", () => {
      // \x04abc — only 3 hex chars, not a complete RRGGBB → reset + "abctail" text.
      const runs = parseMircFormat("\x04abctail");
      expect(runs[0]?.fg).toBeUndefined();
      expect(runs[0]?.text).toBe("abctail");
    });

    it("\\x04 and \\x03 colors interoperate (later code wins)", () => {
      const runs = parseMircFormat("\x04ff0000hex\x034palette");
      expect(runs[0]?.fg).toBe("#ff0000");
      expect(runs[1]?.fg).toBe(MIRC_PALETTE[4]);
    });
  });

  describe("MIRC_PALETTE", () => {
    it("has 99 entries (codes 0-98)", () => {
      expect(MIRC_PALETTE).toHaveLength(99);
    });

    it("has white at 0 and black at 1 (mIRC convention)", () => {
      expect(MIRC_PALETTE[0]).toBe("#ffffff");
      expect(MIRC_PALETTE[1]).toBe("#000000");
    });
  });
});

// #2029 — the render-side projection of the SAME parse: run structure kept,
// every formatting attribute cleared. This is what `MircBody` swaps in when
// the reader has the strip preference on, so what it preserves and what it
// drops IS the feature.
describe("mircPlainRuns", () => {
  // The body carries the whole control set the issue enumerates: colour,
  // hex colour, bold, italic, underline, strikethrough, monospace, reverse,
  // reset. If one of them survived as an attribute, this fails.
  const EVERYTHING =
    "\x02bold\x02 \x1ditalic\x1d \x1funder\x1f \x1estrike\x1e " +
    "\x11mono\x11 \x16rev\x16 \x034red\x03 \x04ff8800hex\x04 \x0fplain";

  it("keeps the visible text byte-for-byte, the same text the styled parse yields", () => {
    // Not a hardcoded expectation: the styled parse is the reference, so this
    // cannot drift into asserting a text the renderer never produces.
    const styled = parseMircFormat(EVERYTHING)
      .map((r) => r.text)
      .join("");
    expect(
      mircPlainRuns(EVERYTHING)
        .map((r) => r.text)
        .join(""),
    ).toBe(styled);
  });

  it("clears every formatting attribute on every run", () => {
    const runs = mircPlainRuns(EVERYTHING);
    expect(runs.length).toBeGreaterThan(1); // the body really does split
    for (const run of runs) {
      expect(run.bold).toBe(false);
      expect(run.italic).toBe(false);
      expect(run.underline).toBe(false);
      expect(run.strikethrough).toBe(false);
      expect(run.monospace).toBe(false);
      expect(run.reverse).toBe(false);
      expect(run.fg).toBeUndefined();
      expect(run.bg).toBeUndefined();
    }
  });

  // The control that proves the fixture is not vacuous: the STYLED parse of
  // the same body must carry the attributes this strips. Without it, a body
  // that happened to be plain would make the block above pass on nothing.
  it("NEGATIVE CONTROL: the styled parse of the same body DOES carry attributes", () => {
    const styled = parseMircFormat(EVERYTHING);
    expect(styled.some((r) => r.bold)).toBe(true);
    expect(styled.some((r) => r.italic)).toBe(true);
    expect(styled.some((r) => r.underline)).toBe(true);
    expect(styled.some((r) => r.strikethrough)).toBe(true);
    expect(styled.some((r) => r.monospace)).toBe(true);
    expect(styled.some((r) => r.reverse)).toBe(true);
    expect(styled.some((r) => r.fg !== undefined)).toBe(true);
  });

  // Pins the ruling that the runs are NOT merged. Merging would repair a URL
  // split by a colour code — a real improvement, and a behaviour change that
  // does not belong to an issue about removing colours.
  it("does NOT merge the runs — same boundaries as the styled parse", () => {
    const styled = parseMircFormat(EVERYTHING);
    const plain = mircPlainRuns(EVERYTHING);
    expect(plain).toHaveLength(styled.length);
    expect(plain.map((r) => r.text)).toEqual(styled.map((r) => r.text));
  });

  it("leaves a body with no control bytes exactly as the styled parse leaves it", () => {
    expect(mircPlainRuns("hello world")).toEqual(parseMircFormat("hello world"));
  });

  it("yields no runs for an empty body (the zero-run contract MircBody relies on)", () => {
    expect(mircPlainRuns("")).toEqual([]);
  });
});
