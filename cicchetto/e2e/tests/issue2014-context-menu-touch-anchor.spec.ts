// issue 2014 — on iOS the long-press message menu opened DOWN-AND-RIGHT of the
// touch point, so the hand that opened it covered it. The ask, in the
// reporter's words, is that the menu's BOTTOM-RIGHT CORNER sit on the press
// point: the menu opens up-and-left, out from under the thumb. On a mouse the
// native down-and-right convention stands, unchanged.
//
// WHY THIS SPEC EXISTS AT ALL — the issue says the suite cannot host the
// gesture, and that is FALSE, measured: `issue1067-swipe-reply-message-menu`
// has synthesized a real touchstart → wall-clock hold → touchend since #1067,
// and its header records that `hasTouch: true` puts Chromium's primary pointer
// at COARSE. Both halves of what this needs were already in the repo. The
// citation that fed the issue is about `webkit-iphone-15`'s `tap()`, which is a
// different engine and a different verb.
//
// THE EXPERIMENT, and it is three tests because the fix has two claims:
//   1. the reported path — coarse pointer, long-press, message row;
//   2+3. the GATE, isolated. Same door (a synthetic `contextmenu`), same
//        surface (the members-pane nick menu), ONE variable changed: the
//        pointer. Coarse answers bottom-right, fine answers top-left. Without
//        the pair, test 1 alone leaves "maybe it is the DOOR that decides"
//        standing, which is exactly the design decision worth pinning — the
//        anchor is keyed on the pointing device, not on which door opened.
//   2+3 also carry the SCOPE: vjt ruled "tutta la shell" (2026-09-09 00:24Z),
//   so the nick menu — a different host of the same shell, which passes no
//   anchor of its own — must inherit the same answer as the message menu.
//
// EVERY test asserts an ANTI-HOLLOW PRECONDITION first (the #487 sibling's
// pattern): that at the chosen point the menu would have fitted on BOTH sides
// of both axes. Without it the assertion is satisfiable by a viewport-collision
// FLIP, and flip-vs-anchor is precisely the confusion the issue names — from a
// screenshot near an edge the two are indistinguishable. The point is the
// viewport centre and the viewports are roomy for the same reason: a
// deterministic setup, not a tolerance.
//
// ⚠️ LIMITS, and they are the reason this is not the whole proof. ⚠️
// Chromium is not iOS. `env(safe-area-inset-*)` is {0,0,0,0} on every engine in
// this suite, so the safe-area interval degenerates to the viewport and nothing
// here exercises the notch or the home indicator — that arithmetic is unit
// work (src/__tests__/menuPosition.test.ts, which carries the iPhone 15 insets)
// and the FELT result is vjt's on-device dogfood. What this file proves is the
// ANCHOR and its GATE against a real layout engine. It says nothing about
// iOS-specific placement, and must not be read as saying it.
//
// The touch synthesizer below is a THIRD copy of the one in
// `issue1067-swipe-reply-message-menu` and `issue1413-hold-press-feedback`.
// Left local, matching its neighbours, rather than extracted here: hoisting it
// into a fixture would rewrite two specs this change has no business touching.
import type { Page } from "@playwright/test";
import { composeSend, loginAs, scrollbackLine, selectChannel } from "../fixtures/cicchettoPage";
import { AUTOJOIN_CHANNELS, NETWORK_SLUG } from "../fixtures/seedData";
import { expect, specNick, specUser, test } from "../fixtures/test";

test.setTimeout(90_000);

const CHANNEL = AUTOJOIN_CHANNELS[0];

// Comfortably above LONG_PRESS_MS (500) so the hold classification is
// deterministic under load; setTimeout never fires early. Same value, same
// reason, as the #1067 spec.
const HOLD_MS = 700;

// Roomy on purpose. The centre of a 1024×800 box leaves ~500px of slack on
// each side of both axes, which is what makes the both-anchors-fit
// precondition hold with margin instead of by luck — and `hasTouch: true` is
// what puts the pointer at coarse, NOT the viewport size.
const TOUCH_VIEWPORT = { width: 1024, height: 800 };
const MOUSE_VIEWPORT = { width: 1280, height: 800 };

// Date.now() suffix + a per-test tag: the e2e sqlite scrollback survives
// KEEP_STACK=1 re-runs and is shared by the tests in this file, so an untagged
// module-level body would match twice and die of Playwright strict mode.
const bodyFor = (tag: string): string => `2014 ${tag} target ${Date.now()}`;

type Point = { x: number; y: number };

function viewportCentre(page: Page): Point {
  const vp = page.viewportSize();
  if (!vp) throw new Error("no viewport size");
  return { x: Math.round(vp.width / 2), y: Math.round(vp.height / 2) };
}

async function menuGeometry(page: Page) {
  return await page.evaluate(() => {
    const menu = document.querySelector(".context-menu");
    if (!(menu instanceof HTMLElement)) throw new Error("context menu not rendered");
    const m = menu.getBoundingClientRect();
    return {
      top: m.top,
      left: m.left,
      right: m.right,
      bottom: m.bottom,
      width: m.width,
      height: m.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    };
  });
}

type Geometry = Awaited<ReturnType<typeof menuGeometry>>;

// The anti-hollow precondition. Both anchors have to be POSSIBLE at this point,
// or the corner assertion that follows proves nothing: near an edge the
// collision flip produces the far corner all by itself, under either
// preference, and the test would go green on a reverted fix.
function expectBothAnchorsWouldFit(g: Geometry, at: Point): void {
  expect(g.width).toBeGreaterThan(0);
  expect(g.height).toBeGreaterThan(0);
  expect(at.x - g.width).toBeGreaterThanOrEqual(0);
  expect(at.x + g.width).toBeLessThanOrEqual(g.innerWidth);
  expect(at.y - g.height).toBeGreaterThanOrEqual(0);
  expect(at.y + g.height).toBeLessThanOrEqual(g.innerHeight);
}

async function seedChannel(page: Page): Promise<void> {
  await loginAs(page, specUser());
  await selectChannel(page, NETWORK_SLUG, CHANNEL, { ownNick: specNick() });
}

async function seedRow(page: Page, tag: string): Promise<string> {
  await seedChannel(page);
  const body = bodyFor(tag);
  await composeSend(page, body);
  await expect(scrollbackLine(page, "privmsg", body)).toBeVisible({ timeout: 5_000 });
  return body;
}

// touchstart → real wall-clock hold → touchend, with no movement: the press.
// Dispatched in-page ON the row, so it reaches the production listener by
// bubbling to `.scrollback` exactly as a finger does; the coordinates ride on
// the Touch and are what `bindMessageGestures` hands the menu as its `at`.
async function longPressRow(page: Page, body: string, at: Point, holdMs: number): Promise<void> {
  await page.evaluate(
    async ({ body: text, at: point, holdMs: ms }) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="scrollback-line"]'),
      );
      const row = rows.find((r) => r.textContent?.includes(text));
      if (row === undefined) throw new Error(`no scrollback row containing ${text}`);
      const mk = () =>
        new Touch({ identifier: 1, target: row, clientX: point.x, clientY: point.y });
      const fire = (type: "touchstart" | "touchend"): void => {
        const t = mk();
        const active = type === "touchend" ? [] : [t];
        row.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: active,
            targetTouches: active,
            changedTouches: [t],
          }),
        );
      };
      fire("touchstart");
      await new Promise((r) => setTimeout(r, ms));
      fire("touchend");
    },
    { body, at, holdMs },
  );
  await expect(page.locator(".context-menu")).toBeVisible({ timeout: 5_000 });
}

// The other door, on the other host: a synthetic `contextmenu` on the first
// members-pane nick. Same shape as the #487 spec's opener — the handler reads
// the coordinates off the event, not off the element box, so the press point is
// ours to choose.
async function contextMenuOnNick(page: Page, at: Point): Promise<void> {
  await expect(page.locator(".members-pane .member-name").first()).toBeVisible({ timeout: 5_000 });
  await page.evaluate((point) => {
    const btn = document.querySelector(".members-pane .member-name");
    if (!(btn instanceof HTMLElement)) throw new Error("no .member-name button in members-pane");
    btn.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  }, at);
  await expect(page.locator(".context-menu")).toBeVisible({ timeout: 5_000 });
}

test.describe("issue 2014 — coarse pointer anchors the menu's bottom-right corner", () => {
  test.use({ viewport: TOUCH_VIEWPORT, hasTouch: true });

  test("a long-press puts the message menu's bottom-right corner on the press point", async ({
    page,
  }) => {
    const body = await seedRow(page, "longpress");
    const at = viewportCentre(page);

    await longPressRow(page, body, at, HOLD_MS);
    const g = await menuGeometry(page);

    // The harness premise, asserted rather than assumed: `hasTouch` is what
    // puts this project on the coarse branch, and if that ever stops being
    // true this file would silently be testing the mouse behaviour twice.
    expect(g.coarsePointer).toBe(true);
    expectBothAnchorsWouldFit(g, at);

    expect(g.right).toBeCloseTo(at.x, 0);
    expect(g.bottom).toBeCloseTo(at.y, 0);
    // The discriminant, stated rather than left implicit: the NEAR corner is
    // where the defect put it, and it must not be there any more.
    expect(g.left).toBeLessThan(at.x);
    expect(g.top).toBeLessThan(at.y);
  });

  test("the nick menu inherits it from the shell, passing no anchor of its own", async ({
    page,
  }) => {
    await seedChannel(page);
    const at = viewportCentre(page);

    await contextMenuOnNick(page, at);
    const g = await menuGeometry(page);

    expect(g.coarsePointer).toBe(true);
    expectBothAnchorsWouldFit(g, at);

    expect(g.right).toBeCloseTo(at.x, 0);
    expect(g.bottom).toBeCloseTo(at.y, 0);
  });
});

test.describe("issue 2014 — a fine pointer keeps the native down-and-right menu", () => {
  test.use({ viewport: MOUSE_VIEWPORT, hasTouch: false });

  test("the same nick menu, same door, opens from the click when the pointer is a mouse", async ({
    page,
  }) => {
    await seedChannel(page);
    const at = viewportCentre(page);

    await contextMenuOnNick(page, at);
    const g = await menuGeometry(page);

    // The one variable. Everything else in this test is the test above.
    expect(g.coarsePointer).toBe(false);
    expectBothAnchorsWouldFit(g, at);

    expect(g.left).toBeCloseTo(at.x, 0);
    expect(g.top).toBeCloseTo(at.y, 0);
    expect(g.right).toBeGreaterThan(at.x);
    expect(g.bottom).toBeGreaterThan(at.y);
  });
});
