// issue 2037 — MEASUREMENT INSTRUMENT for the ANCHOR term, not a regression
// test.
//
// The issue body says own-authored rows plus the content/events split account
// for the bar-vs-badge mismatch "in direction and in kind" but not in size
// (1807 - 403 = 1404), and names the ANCHOR as the remaining candidate:
//
//   > `resolveJumpTarget` returns `missed` from `probeGap(cursor)` but falls
//   > back to `missedAtAnchor` with `resumeFrom: anchor` when the probe fails
//   > — two different anchors reachable on the same screen.
//
// The anchor lives on the CLIENT, so this is where it is measurable. What is
// measured here is not just the size of the term but its SIGN: a residual of
// +1404 needs a term that makes the BAR BIGGER than the badge, and the two
// anchors this file exercises are ordered (`cursor <= high-water mark`) with
// `countMessagesAfter` monotone non-increasing in its anchor.
//
// Controls, both inside the file and both asserted before the sign claim:
//   * POSITIVE — the divergent case must actually reach the wire with TWO
//     DIFFERENT anchors. Without that assertion a passing sign check would be
//     compatible with a harness that only ever probed once.
//   * NEGATIVE — when the cursor equals the anchor, exactly ONE probe is made
//     and there is no anchor term at all.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrollbackMessage } from "../lib/api";

vi.mock("../lib/socket", () => ({
  joinUser: vi.fn(() => ({ on: vi.fn(), push: vi.fn().mockReturnValue({ receive: vi.fn() }) })),
  joinChannel: vi.fn(() => ({
    join: vi.fn(() => ({ receive: vi.fn().mockReturnValue({ receive: vi.fn() }) })),
    on: vi.fn(),
  })),
  pushCloseQueryWindow: vi.fn(),
  pushOpenQueryWindow: vi.fn(),
  notifyClientClosing: vi.fn(),
  pushAwaySet: vi.fn(),
  pushAwayUnset: vi.fn(),
}));

let mockTokenValue: string | null = null;
vi.mock("../lib/auth", () => ({
  token: () => mockTokenValue,
  setToken: vi.fn((v: string | null) => {
    mockTokenValue = v;
  }),
}));

const listMessagesSpy = vi.fn<(...a: unknown[]) => Promise<ScrollbackMessage[]>>();
const listMessagesAfterSpy = vi.fn<(...a: unknown[]) => Promise<ScrollbackMessage[]>>();
const countMessagesAfterSpy = vi.fn<(...a: unknown[]) => Promise<number>>();
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listMessages: (...args: unknown[]) => listMessagesSpy(...args),
    listMessagesAfter: (...args: unknown[]) => listMessagesAfterSpy(...args),
    countMessagesAfter: (...args: unknown[]) => countMessagesAfterSpy(...args),
  };
});

const setReadCursorSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/readCursor", async () => {
  const actual = await vi.importActual<typeof import("../lib/readCursor")>("../lib/readCursor");
  return {
    ...actual,
    setReadCursor: (...args: Parameters<typeof actual.setReadCursor>) => setReadCursorSpy(...args),
  };
});

const PAGE_LIMIT = 200;

const row = (id: number): ScrollbackMessage => ({
  id,
  network: "net",
  channel: "#chan",
  server_time: 1_700_000_000 + id,
  kind: "privmsg",
  sender: "peer",
  body: `line ${id}`,
  meta: {},
});

// The anchors the two probes carry, recovered from the spy rather than
// assumed: `countMessagesAfter(t, slug, name, anchor)`.
const anchorsProbed = (): number[] => countMessagesAfterSpy.mock.calls.map((c) => c[3] as number);

describe("issue 2037 — the ANCHOR term, measured with its sign", () => {
  beforeEach(async () => {
    const { clearReadCursors } = await import("../lib/readCursor");
    clearReadCursors();
    setReadCursorSpy.mockClear();
    listMessagesSpy.mockReset();
    listMessagesSpy.mockResolvedValue([]);
    listMessagesAfterSpy.mockReset();
    listMessagesAfterSpy.mockResolvedValue([]);
    countMessagesAfterSpy.mockReset();
    countMessagesAfterSpy.mockResolvedValue(0);
    mockTokenValue = "test-bearer";
  });

  // NEGATIVE CONTROL. The cold-open path holds ONE anchor: the read cursor,
  // which is the same integer `ReadCursor.bulk_unread_split/3` anchors the
  // sidebar seed at. No anchor term exists on this path — so a residual
  // measured on a cold open cannot be blamed on the anchor.
  it("NEG CTRL — cold open probes exactly once, at the read cursor", async () => {
    const { loadInitialScrollback, farBehindByChannel } = await import("../lib/scrollback");
    const { applyJoinReply } = await import("../lib/readCursor");
    const { channelKey } = await import("../lib/channelKey");

    applyJoinReply("net", "#coldprobe", 100);
    countMessagesAfterSpy.mockResolvedValue(1807);
    listMessagesSpy.mockResolvedValue([row(1907), row(1906)]);

    await loadInitialScrollback("net", "#coldprobe");

    expect(anchorsProbed()).toEqual([100]);
    expect(farBehindByChannel()[channelKey("net", "#coldprobe")]).toEqual({
      missed: 1807,
      resumeFrom: 100,
    });
  });

  // POSITIVE CONTROL + the measurement. The reconnect path holds TWO anchors:
  // the high-water mark of the page it just ingested, and the read cursor
  // behind it. The control is that both reach the wire; the measurement is
  // which number the bar ends up rendering.
  it("POS CTRL — reconnect probes TWO anchors; the bar renders the CURSOR one", async () => {
    const { refreshScrollback, farBehindByChannel } = await import("../lib/scrollback");
    const { applyJoinReply } = await import("../lib/readCursor");
    const { channelKey } = await import("../lib/channelKey");

    applyJoinReply("net", "#twoanchors", 100);
    // A FULL page, so the >1-page probe arm is entered. Its last row is the
    // high-water anchor.
    const page = Array.from({ length: PAGE_LIMIT }, (_, i) => row(101 + i));
    listMessagesAfterSpy.mockResolvedValue(page);
    listMessagesSpy.mockResolvedValue([row(2000)]);
    // Monotone in the anchor: the earlier anchor (the cursor) counts MORE.
    countMessagesAfterSpy.mockImplementation(async (..._a: unknown[]) => {
      const anchor = _a[3] as number;
      return anchor === 100 ? 1807 : 1500;
    });

    await refreshScrollback("net", "#twoanchors");

    const probed = anchorsProbed();
    // POS CTRL: two DISTINCT anchors actually reached the wire, and they are
    // ordered cursor <= high-water. Without this the sign claim below would
    // be vacuous.
    expect(probed).toHaveLength(2);
    expect(new Set(probed).size).toBe(2);
    expect(probed[0]).toBe(300);
    expect(probed[1]).toBe(100);
    expect(probed[1] as number).toBeLessThan(probed[0] as number);

    expect(farBehindByChannel()[channelKey("net", "#twoanchors")]).toEqual({
      missed: 1807,
      resumeFrom: 100,
    });
  });

  // THE SIGN. The one branch that renders the OTHER anchor's number is the
  // re-probe failure the issue body names. Measured: it renders the SMALLER
  // number, because the anchor it falls back to is FURTHER FORWARD than the
  // cursor and `count_after/6` is monotone non-increasing in its anchor.
  //
  // Consequence for the issue: the anchor term is bounded ABOVE by zero. It
  // can only ever make the far-behind bar UNDERCOUNT relative to a
  // cursor-anchored badge — it cannot supply a positive 1404.
  it("SIGN — a failed re-probe renders the HIGH-WATER number, which is SMALLER", async () => {
    const { refreshScrollback, farBehindByChannel } = await import("../lib/scrollback");
    const { applyJoinReply } = await import("../lib/readCursor");
    const { channelKey } = await import("../lib/channelKey");

    applyJoinReply("net", "#reprobefail", 100);
    const page = Array.from({ length: PAGE_LIMIT }, (_, i) => row(101 + i));
    listMessagesAfterSpy.mockResolvedValue(page);
    listMessagesSpy.mockResolvedValue([row(2000)]);
    countMessagesAfterSpy.mockImplementation(async (..._a: unknown[]) => {
      const anchor = _a[3] as number;
      if (anchor === 100) throw new Error("probe failed");
      return 1500;
    });

    await refreshScrollback("net", "#reprobefail");

    const far = farBehindByChannel()[channelKey("net", "#reprobefail")];
    expect(far).toEqual({ missed: 1500, resumeFrom: 300 });
    // The fallback number is SMALLER than the cursor-anchored one (1807 in
    // the case above, same fixture): the anchor term's sign is <= 0.
    expect(far?.missed as number).toBeLessThan(1807);
  });

  // Where the SIDEBAR number comes from while the bar is up. The seed is
  // whatever the server last pushed for the key; the bar is a separate probe.
  // Two numbers, two server functions, ONE anchor — so the residual between
  // them is a PREDICATE difference, not an anchor difference.
  it("the far-behind badge is the server seed, untouched by the bar's probe", async () => {
    const { loadInitialScrollback } = await import("../lib/scrollback");
    const { applyJoinReply } = await import("../lib/readCursor");
    const { channelKey } = await import("../lib/channelKey");
    const { setServerSeedCount, messagesUnread, eventsUnread } = await import("../lib/selection");

    const key = channelKey("net", "#seedwins");
    applyJoinReply("net", "#seedwins", 100);
    // The join reply's `window_counts` — `Scrollback.count_after_split/6`,
    // anchored at the SAME cursor the bar probes at.
    setServerSeedCount(key, { messages: 187, events: 216 });
    countMessagesAfterSpy.mockResolvedValue(1807);
    listMessagesSpy.mockResolvedValue([row(1907), row(1906)]);

    await loadInitialScrollback("net", "#seedwins");

    expect(messagesUnread()[key]).toBe(187);
    expect(eventsUnread()[key]).toBe(216);
    // ...while the bar rendered 1807 from the same anchor. Same anchor, three
    // numbers.
    expect(anchorsProbed()).toEqual([100]);
  });
});
