import { fireEvent } from "@solidjs/testing-library";

// issue 1956 — `ContextMenu` refuses a pointer activation until it has seen a
// press that BEGAN after it opened. On iOS the long-press menu opens 500ms into
// a touch that is still down, and the click WebKit synthesizes when that finger
// lifts lands on the menu's own full-viewport backdrop: without the guard it
// closes the menu, or fires the item nearest the finger, before either can be
// read.
//
// This helper is NOT a way past that guard. `fireEvent.click` dispatches a bare
// `click`, which no browser ever produces — a real activation is always
// preceded by a `pointerdown`. So a test that means "the operator picked this
// item" has to say it the way the platform says it, or it is asserting against
// a DOM sequence that cannot occur. The helper makes the simulation FAITHFUL;
// the guard is what changed, and the contract with it.
//
// The refusal has its own direct coverage (`ContextMenu.test.tsx`, the
// "issue 1956" block): a bare click with no press must NOT act, and that is the
// test which fails if the guard is ever removed. These call sites assert the
// other half — that a real press-then-click still works, on every door and
// every menu that shares this shell.
//
// A plain `Event` rather than a `PointerEvent`: jsdom ships no PointerEvent
// constructor, and the guard reads nothing off the event but its arrival.
export function pressAndClick(el: Element): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  fireEvent.click(el);
}
