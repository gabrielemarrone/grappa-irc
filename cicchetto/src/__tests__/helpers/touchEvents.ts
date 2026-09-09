// Synthetic touch events for jsdom. jsdom ships no TouchEvent constructor, so
// we shape a cancelable Event carrying the `.touches` / `.changedTouches` the
// gesture code reads — which exercises the REAL listener path rather than
// calling the pure geometry helpers directly. Returns the event so callers can
// assert `defaultPrevented` (the claim signal).
//
// Bubbling is deliberate and load-bearing for the call-site tests: the edge
// listener sits on `.shell-mobile`, and a touch that starts on a drawer
// backdrop reaches it by bubbling, exactly as it does in a browser.

export type TouchPoint = { clientX: number; clientY: number };

// The ONE dispatcher the three wrappers below share. Extracted when issue 1956
// needed a NON-cancelable touchend: a third near-copy of the same nine lines is
// how the `touches` / `changedTouches` shaping drifts between them, and the
// shaping is the part every gesture listener actually reads.
function dispatchTouch(
  el: HTMLElement,
  type: string,
  init: { cancelable: boolean; timeStamp?: number },
  points: TouchPoint[],
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: init.cancelable });
  const list = points as unknown as TouchList;
  Object.defineProperty(ev, "touches", {
    value: type === "touchend" ? ([] as unknown as TouchList) : list,
  });
  Object.defineProperty(ev, "changedTouches", { value: list });
  if (init.timeStamp !== undefined) {
    Object.defineProperty(ev, "timeStamp", { value: init.timeStamp });
  }
  el.dispatchEvent(ev);
  return ev;
}

export function fireTouch(el: HTMLElement, type: string, ...points: TouchPoint[]): Event {
  return dispatchTouch(el, type, { cancelable: true }, points);
}

// issue 1956 — a touch the browser will NOT let a listener cancel. WebKit hands
// these out once it has decided the gesture is its own, and `preventDefault` on
// one is SILENT: no throw, no `defaultPrevented`, so a shield built on it reads
// applied while doing nothing. Candidate A of the iOS long-press-menu diagnosis
// is exactly that shape, which is why the suite has to be able to spell it.
export function fireTouchUncancelable(
  el: HTMLElement,
  type: string,
  ...points: TouchPoint[]
): Event {
  return dispatchTouch(el, type, { cancelable: false }, points);
}

// Same, with a chosen `timeStamp` — for gestures whose decision reads the clock
// (#1438's velocity gate). It has to be its own function rather than a caller
// stamping the returned event: `fireTouch` DISPATCHES before it returns, so a
// `defineProperty` afterwards lands too late and every listener still sees
// jsdom's 0. A gesture graded on velocity would then read every drag as
// instantaneous, and its "slow drag does nothing" arm would pass against an
// implementation with no velocity gate at all.
export function fireTouchAt(
  el: HTMLElement,
  type: string,
  timeStamp: number,
  ...points: TouchPoint[]
): Event {
  return dispatchTouch(el, type, { cancelable: true, timeStamp }, points);
}

// One full edge swipe: start → two moves → end. The intermediate moves are what
// let the directive claim mid-drag (it claims late, never on touchstart).
export function swipeHorizontally(el: HTMLElement, fromX: number, toX: number, y: number): void {
  fireTouch(el, "touchstart", { clientX: fromX, clientY: y });
  fireTouch(el, "touchmove", { clientX: fromX + (toX - fromX) / 3, clientY: y + 5 });
  fireTouch(el, "touchmove", { clientX: fromX + ((toX - fromX) * 2) / 3, clientY: y + 8 });
  fireTouch(el, "touchend", { clientX: toX, clientY: y + 10 });
}
