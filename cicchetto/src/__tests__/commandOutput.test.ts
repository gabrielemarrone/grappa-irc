import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelKey } from "../lib/channelKey";

// #162 — the in-window verb answer store. What is worth pinning: one entry
// per LINE sharing one `at` (the lines of an answer never interleave with a
// message), ask-order accumulation, and window keying.

vi.mock("../lib/auth", () => ({ token: () => "tok" }));

const k = (name: string) => `freenode ${name}` as ChannelKey;

describe("commandOutput store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const header = { label: "Ignore list for freenode:", text: "", indent: false };
  const member = (text: string) => ({ label: null, text, indent: true });

  it("appends one entry per line, in order, all stamped with one `at`", async () => {
    const { appendCommandOutput, commandOutputByWindow } = await import("../lib/commandOutput");
    appendCommandOutput(k("#a"), [header, member("spambot!*@*"), member("*!*@*.evil.example")]);

    const rows = commandOutputByWindow()[k("#a")] ?? [];
    expect(rows.map((r) => [r.label, r.text, r.indent])).toEqual([
      ["Ignore list for freenode:", "", false],
      [null, "spambot!*@*", true],
      [null, "*!*@*.evil.example", true],
    ]);
    expect(new Set(rows.map((r) => r.at)).size).toBe(1);
    expect(rows[2]?.ts).toBeGreaterThan(rows[0]?.ts ?? 0);
  });

  it("accumulates across invocations — asking twice prints twice", async () => {
    const { appendCommandOutput, commandOutputByWindow } = await import("../lib/commandOutput");
    appendCommandOutput(k("#a"), [{ label: "Ignore:", text: "first", indent: false }]);
    appendCommandOutput(k("#a"), [{ label: "Unignore:", text: "second", indent: false }]);

    const rows = commandOutputByWindow()[k("#a")] ?? [];
    expect(rows.map((r) => `${r.label} ${r.text}`)).toEqual(["Ignore: first", "Unignore: second"]);
  });

  it("keys on the submitting window, so two windows never share rows", async () => {
    const { appendCommandOutput, commandOutputByWindow } = await import("../lib/commandOutput");
    appendCommandOutput(k("#a"), [member("x")]);

    expect(commandOutputByWindow()[k("#a")]).toHaveLength(1);
    expect(commandOutputByWindow()[k("#b")]).toBeUndefined();
  });
});
