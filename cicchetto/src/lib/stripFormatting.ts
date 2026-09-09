import { createSignal } from "solid-js";
import { moduleRoot } from "./moduleRoot";

// #2029 — "strip mIRC formatting" display preference. Boolean, OFF by
// default: colours keep rendering exactly as they do today, and a reader opts
// into flat text.
//
// Requested by `morph` (Azzurra staff) after a channel filled up with heavily
// coloured bot output. The obvious neighbour is channel mode `+c`, and it is
// NOT this: `+c` is a channel-wide policy an operator sets, and it REJECTS the
// message at the server, so the reader loses the words along with the colours.
// This is per-viewer and strips on RENDER — the words still arrive, they just
// arrive plain. That is also why the raw line is untouched on the wire and in
// scrollback: toggling back restores the colours with no reconnect, because
// nothing was ever thrown away.
//
// ## SYNCED, on #1766's criterion rather than a coin toss
//
// This takes colorNicklist.ts's SHAPE and its POSTURE: one of the #449
// server-backed display prefs, coordinated by `displayPrefs.ts` over
// `GET/PUT /me/settings/display-prefs`. #914's `hideNextActive` sits in the
// same settings fieldset and is deliberately per-DEVICE, so the divergence
// needs a reason. #1766 already fixed which one: a per-device toggle is right
// when the complaint is about a VIEWPORT, and wrong when it is about the
// ACCOUNT. A channel full of coloured bot output is identical on the phone and
// on the desktop — the account axis — and the pref's nearest neighbour by
// shape, `colored_nicklist`, is synced for that same reason. Two adjacent
// checkboxes that persist differently is the surprise this avoids.
//
// localStorage is the boot/offline cache for a FOUC-free first paint, not the
// source of truth: the server wins on login, or is seeded up once when it has
// never persisted. `setStripFormatting` stays LOCAL-only (signal +
// localStorage write-through); the coordinator's `syncedSetStripFormatting`
// adds the PUT.
//
// ## Why a signal
//
// Same argument as colorNicklist.ts: the flag is read at RENDER time, by
// `MircBody` — the ONE chokepoint every mIRC-formatted surface funnels
// through. A bare `localStorage.getItem` there would never re-run, so an open
// pane would keep its colours until a reload, and "without a reconnect" is
// half of what this issue asks for.

const STORAGE_KEY = "cicchetto.stripFormatting";
const DEFAULT_ON = false;

function readStored(): boolean {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === null ? DEFAULT_ON : v === "true";
}

// Module-singleton signal seeded from storage. createRoot anchors it for the
// app lifetime (same shape as colorNicklist.ts) — the preference is
// identity-agnostic, so no token-rotation reset arm is needed.
const { current, setCurrent } = moduleRoot(() => {
  const [current, setCurrent] = createSignal<boolean>(readStored());
  return { current, setCurrent };
});

export function getStripFormatting(): boolean {
  return current();
}

export function setStripFormatting(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
  setCurrent(on);
}
