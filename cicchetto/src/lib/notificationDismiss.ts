// #2034 — the other half of the notification lifecycle: a notification
// leaves the shade when its conversation comes back into view, not only
// when it is tapped.
//
// The tap half has always been there (`notificationclick` calls
// `event.notification.close()` in `service-worker.ts`). Nothing ever took
// a notification BACK, so reading a conversation in the app left its
// banners sitting in the shade, and a later tap yanked the reader to a
// window they had caught up with minutes ago.
//
// The whole mechanism is a sweep: enumerate what the registration is
// currently showing, resolve each notification to the WINDOW it names,
// close the ones naming the focused window. No new state, no new server
// field, no bookkeeping to drift — the notification's own `data.url` is
// the identity, and the selection store is the "what is the reader
// looking at" oracle both this module and `pushTarget.ts` already read.
//
// Deliberately NOT keyed on the payload `tag`. `getNotifications({ tag })`
// needs the tag SPELLED client-side, which means a second copy of
// `Grappa.Push.Payload`'s format — and it would be a WRONG copy for DMs,
// where the server tags with the raw wire nick (`libera:Alice`) while the
// selection store holds the canonical window nick (`alice`). Filtering by
// an exact-match tag we cannot construct correctly closes nothing. The URL
// is already parsed by `parsePushTargetUrl` for the tap path, so reusing
// it costs one function call and keeps ONE spelling of push identity.
//
// Presence banners (`<slug>:presence:<nick>`, #378) deep-link to the same
// `?network=&channel=` shape, so opening a peer's query also clears their
// online/offline banner. That falls out of matching on the window rather
// than the tag, and it is the same rule stated for messages: close what
// the reader is looking at.

import { createEffect } from "solid-js";
import { isDocumentVisible } from "./documentVisibility";
import { moduleRoot } from "./moduleRoot";
import { parsePushTargetUrl } from "./pushPayload";
import { pushTargetSelection } from "./pushTarget";
import { isActiveSelection, selectedChannel } from "./selection";

/**
 * Closes every open notification that names the window currently in view.
 * Returns how many were closed (0 on every no-op path) — the count is what
 * the spec asserts against, and it keeps the function honest about doing
 * nothing.
 *
 * No-ops when the document is not visible, WITHOUT enumerating: a
 * backgrounded tab must not be walking the shade on unrelated churn, and
 * "not visible" is exactly the state in which the notification is still
 * doing its job.
 *
 * `getRegistration()` rather than `serviceWorker.ready` (which `push.ts`
 * uses): `ready` NEVER settles when no service worker is registered, and
 * this runs on every focus flip and every window switch, so a browser with
 * SW disabled would accumulate one dangling promise per sweep for the life
 * of the session. `getRegistration()` resolves to `undefined` and the
 * sweep ends.
 */
export async function dismissNotificationsForActiveWindow(): Promise<number> {
  if (!isDocumentVisible()) return 0;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return 0;

  const registration = await navigator.serviceWorker.getRegistration();
  if (registration === undefined) return 0;

  const open = await registration.getNotifications();
  let closed = 0;
  for (const notification of open) {
    if (!namesActiveWindow(notification)) continue;
    notification.close();
    closed += 1;
  }
  return closed;
}

/**
 * True iff `notification` deep-links to the window already in view.
 *
 * A notification with no usable `data.url` — a shape from a future server,
 * or one shown by something other than the push handler — is left alone.
 * Unrecognised is never fatal, and leaving a banner up is the harmless
 * direction of that error: the reader can still dismiss it by hand,
 * whereas closing on a guess destroys a notification nobody read.
 */
function namesActiveWindow(notification: Notification): boolean {
  const data = notification.data as { url?: unknown } | null | undefined;
  const url = data?.url;
  if (typeof url !== "string") return false;

  const target = parsePushTargetUrl(url);
  if (target === null) return false;

  // Through the SAME identity mapping the tap path uses, so "the window
  // this notification opens" and "the window this notification is dismissed
  // by" cannot drift apart.
  return isActiveSelection(pushTargetSelection(target));
}

/**
 * Wires the sweep to the moments a conversation can come into view.
 * Mounted at boot from `main.tsx`, alongside `installPushTargetListener`.
 *
 * Two triggers, because one signal does not cover the PWA:
 *
 *   * the reactive arm — `isDocumentVisible()` (visibilitychange + window
 *     focus/blur) crossed with `selectedChannel()`. This is both halves of
 *     "the conversation is in view": the tab came back, or the reader
 *     switched windows while it was already in front of them.
 *   * `pageshow` — an iOS PWA frequently thaws from a frozen document
 *     without reporting a visibility transition, so the reactive arm never
 *     re-runs (`resumeProbe.ts` / `DiagFloat.tsx` arm on the same pair for
 *     the same reason). The sweep is idempotent, so the overlap between
 *     the two triggers costs nothing.
 *
 * Fire-and-forget: a rejected sweep must not take down the caller's
 * effect, and there is nothing to recover — the next visibility flip
 * sweeps again.
 */
export function installNotificationDismiss(): void {
  moduleRoot(() => {
    createEffect(() => {
      const selection = selectedChannel();
      if (!isDocumentVisible()) return;
      if (selection === null) return;
      void dismissNotificationsForActiveWindow().catch(() => undefined);
    });
  });

  if (typeof window === "undefined") return;
  window.addEventListener("pageshow", () => {
    void dismissNotificationsForActiveWindow().catch(() => undefined);
  });
}
