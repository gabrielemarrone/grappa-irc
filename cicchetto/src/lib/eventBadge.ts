import { createSignal } from "solid-js";
import { moduleRoot } from "./moduleRoot";

// #2037 B — "show the events badge" display preference. Boolean, OFF by
// default, and it is the FIRST of the six whose default takes something away.
//
// vjt's ruling on #2037, verbatim: "dobbiamo avere due bucket: messaggi e
// !messaggi. i !messaggi non sono interessanti e devono solo finire nell'opt-in
// badge." So the sidebar's faint pill — join/part/quit/nick/mode counts, and
// see the warning below for what else — stops rendering unless the operator
// asks for it.
//
// The reported confusion (#2037) was three numbers on one screen for what the
// operator read as one quantity. Two of the three are now the same quantity by
// construction (the far-behind bar and the bold pill both read the messages
// bucket); this removes the third from the default view rather than trying to
// explain it.
//
// ⚠️ WHAT THIS HIDES IS WIDER THAN join/part, and that is deliberate, not a
// refactor accident. The events bucket is `kind not in @content_kinds`, which
// includes `topic`, `kick` and `server_event` — the three that sit OUTSIDE
// `Message.suppressed_presence_kinds/0` on purpose (#458), because the pane
// still RENDERS them even on a presence-denoised channel. Rendering in the pane
// and counting in a badge are different questions, and this pref answers only
// the second. A KICK therefore stops contributing to a badge by default. If a
// kick must stay loud it belongs in the mention/severity channel (#267) — not
// smuggled into the message bucket, which would put a non-message back into the
// number the bar now shares with the pill and undo the whole of #2037 A.
//
// ## SYNCED, on #1766's criterion
//
// Same shape and same posture as stripFormatting.ts: one of the #449
// server-backed display prefs, coordinated by `displayPrefs.ts` over
// `GET/PUT /me/settings/display-prefs`. A per-DEVICE toggle is right when the
// complaint is about a VIEWPORT (#914's `hideNextActive`) and wrong when it is
// about the ACCOUNT. "Is my sidebar cluttered with join/part counts" is
// identical on the phone and on the desktop — the account axis.
//
// localStorage is the boot/offline cache for a FOUC-free first paint, not the
// source of truth. `setShowEventBadge` stays LOCAL-only (signal + write-
// through); the coordinator's synced setter adds the PUT.
//
// ## Why a signal
//
// It is read at RENDER time by `WindowBadges`, on every sidebar row. A bare
// `localStorage.getItem` there would never re-run, so toggling the checkbox
// would leave the pills up until a reload.

const STORAGE_KEY = "cicchetto.showEventBadge";
const DEFAULT_ON = false;

function readStored(): boolean {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === null ? DEFAULT_ON : v === "true";
}

// Module-singleton signal seeded from storage. `createRoot` anchors it for the
// app lifetime (same shape as stripFormatting.ts) — the preference is
// identity-agnostic, so no token-rotation reset arm is needed.
const { current, setCurrent } = moduleRoot(() => {
  const [current, setCurrent] = createSignal<boolean>(readStored());
  return { current, setCurrent };
});

export function getShowEventBadge(): boolean {
  return current();
}

export function setShowEventBadge(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
  setCurrent(on);
}
