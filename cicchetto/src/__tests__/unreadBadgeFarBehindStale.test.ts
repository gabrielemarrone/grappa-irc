import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrollbackMessage } from "../lib/api";
import { channelKey } from "../lib/channelKey";

// issue 2050 — a badge that no in-session gesture can clear, clean again after
// an app restart.
//
// The #693 far-behind record says "the unread region is NOT in this pane". Two
// consumers act on it: `selection.ts`'s `perChannelUnread` discards local truth
// and publishes `serverSeedCounts[key]` instead, and `setCursorIfAdvances`
// FREEZES the read cursor. Both are right only while the cursor is still where
// it was when the record was written.
//
// It does not stay there. Two doors move the cursor without passing through the
// frozen one, and neither tells the far-behind record:
//
//   * `scrollback.sendMessage` — a DIRECT `setReadCursor`, deliberately not
//     routed through `setCursorIfAdvances` (import cycle; see its comment). So
//     it inherits neither the freeze nor any far-behind exit. Talking in the
//     window is enough, on ONE device.
//   * `applyReadCursorSet` — the cross-device echo, unconditional by contract.
//     A peer device reading the channel moves this device's cursor.
//
// Once either fires, the cursor is at the tip and nothing is unread — but the
// record still stands, so the badge keeps publishing the seed, which is written
// ONLY by a per-channel join reply or a `/me` fetch and therefore cannot move
// while the socket stays up. Hence: unclearable in-session, clean after a
// restart (both stores are in-memory).
//
// These tests assert the OUTCOME — the badge, and whether the pane still offers
// a "jump back" bar — not the sequence of calls that produces it. They run the
// REAL scrollback + readCursor + selection stores against a fake server that
// honours `after` / `before` / `limit` and whose cursor the POST actually
// moves; a server that ignored its arguments would arm and clear far-behind for
// reasons of its own.
//
// Deliberately threshold-agnostic: every arm leaves the cursor at the channel
// TIP, where every candidate invalidation rule agrees. The rule itself (which
// bound retires the record) is a separate decision and no assertion here
// depends on it.
//
// What these tests do NOT cover: the browser. This is store-level — jsdom gives
// the pane no geometry, so the read-at-the-tail door is driven through its
// published verb rather than by scrolling, and no assertion here says the fix
// reaches a rendered badge.

vi.mock(import("../lib/api"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listNetworks: vi.fn().mockResolvedValue([]),
    listChannels: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn(),
    listMessagesAfter: vi.fn(),
    countMessagesAfter: vi.fn(),
    sendMessage: vi.fn(),
    me: vi.fn().mockResolvedValue({
      kind: "user",
      id: "u-test",
      name: "vjt",
      is_admin: false,
      inserted_at: "2026-01-01T00:00:00Z",
      read_cursors: {},
    }),
    login: vi.fn(),
    logout: vi.fn(),
    setOn401Handler: vi.fn(),
  };
});

const SLUG = "azzurra";
const CHANNEL = "#grappa";
const KEY = channelKey(SLUG, CHANNEL);
const DEFAULT_PAGE = 50;
const CAUGHT_UP_AT = 1000;

const row = (id: number, sender: string): ScrollbackMessage => ({
  id,
  network: SLUG,
  channel: CHANNEL,
  server_time: id,
  kind: "privmsg",
  sender,
  body: `m${id}`,
  meta: {},
});

/** Rows 1..tip, plus the server-side read cursor the POST moves. */
class FakeServer {
  constructor(
    public tip: number,
    public cursor: number,
  ) {}

  listMessages(before?: number): ScrollbackMessage[] {
    const hi = before === undefined ? this.tip : Math.min(this.tip, before - 1);
    const lo = Math.max(1, hi - DEFAULT_PAGE + 1);
    const out: ScrollbackMessage[] = [];
    for (let i = hi; i >= lo; i--) out.push(row(i, "bob"));
    return out;
  }

  listMessagesAfter(after: number, limit: number): ScrollbackMessage[] {
    const out: ScrollbackMessage[] = [];
    for (let i = after + 1; i <= this.tip && out.length < limit; i++) out.push(row(i, "bob"));
    return out;
  }

  countMessagesAfter(after: number): number {
    return Math.max(0, this.tip - after);
  }
}

let server: FakeServer;

const wireServer = async (): Promise<void> => {
  const api = await import("../lib/api");
  vi.mocked(api.listMessages).mockImplementation(async (_t, _s, _c, before) =>
    server.listMessages(before),
  );
  vi.mocked(api.listMessagesAfter).mockImplementation(async (_t, _s, _c, after, limit) =>
    server.listMessagesAfter(after, limit ?? DEFAULT_PAGE),
  );
  vi.mocked(api.countMessagesAfter).mockImplementation(async (_t, _s, _c, after) =>
    server.countMessagesAfter(after),
  );
  // `readCursor.setReadCursor` POSTs through raw `fetch`. Stub the transport,
  // not the module: the optimistic local advance under test lives inside it.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const id = JSON.parse(init.body).message_id as number;
      if (id > server.cursor) server.cursor = id;
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
};

/** What `subscribe.ts` does on every per-channel join, initial AND rejoin. */
const joinChannelTopic = async (): Promise<void> => {
  const { applyJoinReply } = await import("../lib/readCursor");
  const { setServerSeedCount } = await import("../lib/selection");
  applyJoinReply(SLUG, CHANNEL, server.cursor);
  setServerSeedCount(KEY, { messages: server.countMessagesAfter(server.cursor), events: 0 });
};

/**
 * The reported setup: a long absence has left thousands of rows behind, the
 * socket comes back, and `refreshScrollback` drives the window into #693's
 * far-behind state. Returns once the state is armed.
 */
const absenceThenReconnect = async (): Promise<void> => {
  const { refreshScrollback, farBehindByChannel } = await import("../lib/scrollback");
  await joinChannelTopic();
  await refreshScrollback(SLUG, CHANNEL);
  // The arm is the premise of every assertion below, not a claim of its own.
  expect(farBehindByChannel()[KEY]).toBeDefined();
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  localStorage.setItem("grappa-token", "tok");
  server = new FakeServer(6000, CAUGHT_UP_AT);
});

describe("issue 2050 — a far-behind badge the cursor has already retired", () => {
  it("drops the badge once the operator's own send carries the cursor to the tip", async () => {
    await wireServer();
    const api = await import("../lib/api");
    const scrollback = await import("../lib/scrollback");
    const selection = await import("../lib/selection");
    const { getReadCursor } = await import("../lib/readCursor");
    await absenceThenReconnect();
    expect(selection.messagesUnread()[KEY]).toBe(5000);

    // The operator says something in the window. `sendMessage` advances the
    // cursor with a direct `setReadCursor`, so the #693 freeze does not apply.
    server.tip = 6001;
    vi.mocked(api.sendMessage).mockResolvedValue(row(6001, "vjt"));
    await scrollback.sendMessage(SLUG, CHANNEL, "ciao");

    // Both sides agree the channel is read to the tip...
    expect(getReadCursor(SLUG, CHANNEL)).toBe(6001);
    expect(server.cursor).toBe(6001);
    expect(server.countMessagesAfter(server.cursor)).toBe(0);
    // ...so there is nothing left to badge.
    expect(selection.messagesUnread()[KEY]).toBeUndefined();
  });

  it("drops the badge when a PEER DEVICE reads the channel to the tip", async () => {
    await wireServer();
    const selection = await import("../lib/selection");
    const { applyReadCursorSet, getReadCursor } = await import("../lib/readCursor");
    await absenceThenReconnect();
    expect(selection.messagesUnread()[KEY]).toBe(5000);

    // The laptop reads it all; the server fans `read_cursor_set` to the phone.
    // This is the arm that makes routing the SEND through the far-behind exit
    // insufficient on its own — no gesture happened on this device at all.
    server.cursor = 6000;
    applyReadCursorSet(SLUG, CHANNEL, 6000);

    expect(getReadCursor(SLUG, CHANNEL)).toBe(6000);
    expect(selection.messagesUnread()[KEY]).toBeUndefined();
  });

  it("stops offering 'jump back' once the cursor has consumed the region", async () => {
    await wireServer();
    const scrollback = await import("../lib/scrollback");
    const { applyReadCursorSet } = await import("../lib/readCursor");
    await absenceThenReconnect();

    server.cursor = 6000;
    applyReadCursorSet(SLUG, CHANNEL, 6000);

    // A test that watches only the badge lets this through: the record can be
    // hidden from the count and still stand, which leaves the pane showing a
    // "5000 unread — jump back" bar over a fully-read window AND keeps the
    // cursor frozen for every writer that goes through `setCursorIfAdvances`.
    expect(scrollback.farBehindByChannel()[KEY]).toBeUndefined();
  });

  it("keeps the badge and the bar while the cursor is still behind the region", async () => {
    await wireServer();
    const scrollback = await import("../lib/scrollback");
    const selection = await import("../lib/selection");
    const { applyReadCursorSet } = await import("../lib/readCursor");
    await absenceThenReconnect();

    // A cursor that moved but is still deep inside the abandoned region. The
    // operator is thousands behind and the affordance is the only way back:
    // retiring the record here is the destructive move #693 exists to refuse.
    // The id is far below every candidate invalidation bound, so this arm
    // does not take a side in that choice.
    server.cursor = CAUGHT_UP_AT + 1;
    applyReadCursorSet(SLUG, CHANNEL, CAUGHT_UP_AT + 1);

    expect(scrollback.farBehindByChannel()[KEY]).toBeDefined();
    expect(selection.messagesUnread()[KEY]).toBe(5000);
  });
});
