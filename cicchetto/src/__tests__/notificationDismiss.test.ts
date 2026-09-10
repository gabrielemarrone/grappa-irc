import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissNotificationsForActiveWindow,
  installNotificationDismiss,
} from "../lib/notificationDismiss";

// #2034 — a notification is dismissed when its conversation comes back
// into view, not only when it is tapped.
//
// Boundary: the selection store and the network / query stores are mocked
// (pushTarget.test.ts precedent) so the assertions are about the
// composition this module owns — enumerate the open notifications, resolve
// each one's `data.url` to a WINDOW IDENTITY, close the ones naming the
// focused window — rather than about the fold rules those stores already
// prove. The DM case below is why the identity step exists at all: the
// notification carries the RAW wire nick `Alice` while the focused window
// is `alice`, so a byte compare would leave it sitting in the shade.

// The fixture's whole mutable world: which window is focused, and whether
// the document is visible. Hoisted because the `vi.mock` factories close
// over it, and reset in `beforeEach` — an implementation swapped in by one
// test is exactly the leak that made the pageshow arm below pass for the
// wrong reason while it was being written.
const fixture = vi.hoisted(() => ({
  visible: true,
  active: { networkSlug: "libera", channelName: "#sniffo", kind: "channel" } as {
    networkSlug: string;
    channelName: string;
    kind: string;
  } | null,
}));

const FOCUSED_CHANNEL = { networkSlug: "libera", channelName: "#sniffo", kind: "channel" };

vi.mock("../lib/selection", () => ({
  // Stands in for the real exact-tuple compare (#243 `isActiveSelection`,
  // which folds the channel KEY on the way in). Byte-equal here: the fold
  // is selection.ts's contract and is proven there.
  isActiveSelection: vi.fn(
    (sel: { networkSlug: string; channelName: string; kind: string } | null) => {
      const active = fixture.active;
      return (
        sel !== null &&
        active !== null &&
        sel.networkSlug === active.networkSlug &&
        sel.channelName === active.channelName &&
        sel.kind === active.kind
      );
    },
  ),
  selectedChannel: vi.fn(() => fixture.active),
  setSelectedChannel: vi.fn(),
}));

vi.mock("../lib/documentVisibility", () => ({
  isDocumentVisible: vi.fn(() => fixture.visible),
}));

vi.mock("../lib/networks", () => ({
  networkBySlug: vi.fn((slug: string) =>
    slug === "libera" ? { id: 1, slug: "libera", kind: "user" } : undefined,
  ),
  channelsBySlug: vi.fn(() => ({})),
  networks: vi.fn(() => []),
  networkIdBySlug: () => undefined,
}));

// The open query window spells the peer `alice`; the wire spells it
// `Alice`. `canonicalQueryNick` is the store verb that resolves one to the
// other — it returns the OPEN window's stored `targetNick` on a
// casemapping-aware match, so the lowercasing stub here stands in for a
// window that was first opened as `alice`.
vi.mock("../lib/queryWindows", () => ({
  openQueryWindowState: vi.fn(),
  canonicalQueryNick: vi.fn((_networkId: number, nick: string) => nick.toLowerCase()),
}));

type FakeNotification = { data: unknown; close: ReturnType<typeof vi.fn> };

const notification = (url: string | undefined): FakeNotification => ({
  data: url === undefined ? null : { url },
  close: vi.fn(),
});

const originalSW = (navigator as Navigator & { serviceWorker?: unknown }).serviceWorker;

function installFakeServiceWorker(notifications: FakeNotification[]): {
  getNotifications: ReturnType<typeof vi.fn>;
} {
  const getNotifications = vi.fn().mockResolvedValue(notifications);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue({ getNotifications }),
      addEventListener: vi.fn(),
    },
  });
  return { getNotifications };
}

function restoreServiceWorker(): void {
  if (originalSW === undefined) {
    // biome-ignore lint/performance/noDelete: test cleanup
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    return;
  }
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: originalSW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.visible = true;
  fixture.active = { ...FOCUSED_CHANNEL };
});

afterEach(restoreServiceWorker);

describe("dismissNotificationsForActiveWindow", () => {
  it("closes the notifications naming the focused channel and leaves the others", async () => {
    const mine = notification("/?network=libera&channel=%23sniffo");
    const elsewhere = notification("/?network=libera&channel=%23other");
    const otherNetwork = notification("/?network=azzurra&channel=%23sniffo");
    installFakeServiceWorker([mine, elsewhere, otherNetwork]);

    const closed = await dismissNotificationsForActiveWindow();

    expect(mine.close).toHaveBeenCalledTimes(1);
    expect(elsewhere.close).not.toHaveBeenCalled();
    expect(otherNetwork.close).not.toHaveBeenCalled();
    expect(closed).toBe(1);
  });

  it("resolves the RAW wire nick of a DM to the window spelling before comparing", async () => {
    // The focused window is the query `alice`; the payload spells the peer
    // `Alice`, because the server keeps `sender` raw for display.
    fixture.active = { networkSlug: "libera", channelName: "alice", kind: "query" };
    const dm = notification("/?network=libera&channel=Alice");
    installFakeServiceWorker([dm]);

    await dismissNotificationsForActiveWindow();

    expect(dm.close).toHaveBeenCalledTimes(1);
  });

  it("leaves a notification whose data carries no usable URL", async () => {
    const dataless = notification(undefined);
    const malformed = notification("/?network=libera");
    installFakeServiceWorker([dataless, malformed]);

    const closed = await dismissNotificationsForActiveWindow();

    expect(dataless.close).not.toHaveBeenCalled();
    expect(malformed.close).not.toHaveBeenCalled();
    expect(closed).toBe(0);
  });

  it("does nothing while the document is not visible", async () => {
    fixture.visible = false;
    const mine = notification("/?network=libera&channel=%23sniffo");
    const { getNotifications } = installFakeServiceWorker([mine]);

    const closed = await dismissNotificationsForActiveWindow();

    // Not merely "closes nothing": the shade is never enumerated, so a
    // backgrounded tab costs no service-worker round-trip on unrelated
    // churn — and a hidden tab is exactly where the notification is still
    // doing its job.
    expect(getNotifications).not.toHaveBeenCalled();
    expect(mine.close).not.toHaveBeenCalled();
    expect(closed).toBe(0);
  });

  it("is a no-op without a service worker registration", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(dismissNotificationsForActiveWindow()).resolves.toBe(0);
  });

  it("is a no-op when the service worker API is absent altogether", async () => {
    // biome-ignore lint/performance/noDelete: test setup
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;

    await expect(dismissNotificationsForActiveWindow()).resolves.toBe(0);
  });
});

describe("installNotificationDismiss", () => {
  it("sweeps on pageshow — the resume that reports no visibility change", async () => {
    const mine = notification("/?network=libera&channel=%23sniffo");
    const { getNotifications } = installFakeServiceWorker([mine]);

    installNotificationDismiss();
    // The install sweeps once on its own (the window is visible and a
    // conversation is focused the moment the effect runs). Let that settle
    // before asking whether `pageshow` sweeps AGAIN, or the assertion
    // passes on the wrong call.
    await vi.waitFor(() => expect(mine.close).toHaveBeenCalledTimes(1));
    getNotifications.mockClear();
    mine.close.mockClear();

    window.dispatchEvent(new Event("pageshow"));
    // Wait on the CLOSE rather than the enumeration: the sweep awaits the
    // registration and then the notification list before it closes
    // anything, so a wait that stops at `getNotifications` stops two
    // microtask turns early.
    await vi.waitFor(() => expect(mine.close).toHaveBeenCalledTimes(1));

    expect(getNotifications).toHaveBeenCalledTimes(1);
  });
});
