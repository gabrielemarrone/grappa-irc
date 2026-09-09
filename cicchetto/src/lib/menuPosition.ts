// #487 — right-click context-menu placement math. Pure fn (no DOM) so the
// arithmetic is unit-testable without a real viewport; the component feeds it
// real measurements (getBoundingClientRect + window.innerWidth/innerHeight)
// and the real-viewport proof lives in the Playwright e2e
// (issue487-context-menu-viewport-clamp.spec.ts). jsdom returns 0-sized rects,
// so a jsdom placement test would be hollow — hence the seam.
//
// placeAxis is the 1D primitive, applied independently to X and Y, over the
// half-open interval [start, end), with a PREFERRED side. With
// `prefer: "after"`:
//   * fits after the click          → keep the click coord (menu opens down/right)
//   * overflows the far edge         → FLIP before the click (menu opens up/left),
//                                      keeping the pointer on the menu edge like a
//                                      native context menu
//   * flip would underflow `start`   → CLAMP to the last fully-visible coord (menu
//                                      slides off the cursor but stays whole)
//   * menu bigger than the interval  → pin to `start` and let the CSS max-height +
//                                      overflow-y:auto scroll the overflow
//
// #2014 — `prefer` exists because the preferred SIDE was the defect, not the
// collision handling. On iOS the long-press menu opened down-and-right of the
// finger and the hand that opened it covered it; the ask is that the menu's far
// corner sit on the press point instead. From a screenshot that is
// indistinguishable from a viewport-collision flip, which is why it is worth
// saying plainly: the flip is already CORRECT, and near the far edges it
// already produces the wanted geometry. Only the preference is wrong — hence
// one parameter on the existing primitive, and NOT a second placement
// mechanism beside it.
//
// #949 — that interval used to be hardcoded [0, viewport). Under
// `viewport-fit=cover` (index.html) 0 is the PHYSICAL top of the display, so
// the oversize pin put the first row behind the status bar, and `viewport` is
// the physical bottom, so a flip could tuck the tail under the home indicator
// (in landscape, the same on X against the notch/rounded corners). Both edges
// carried the #913 defect at a different door. The interval is now the
// caller's, taken from a fixed `inset: env(safe-area-inset-*)` frame the
// engine lays out — see ContextMenu.tsx for why that frame, and not a JS read
// of `env()`, is the seam.

export type SafeArea = { top: number; right: number; bottom: number; left: number };

// Which side of the press point the box PREFERS, on one axis. 1D on purpose:
// "top-left" means nothing to the X axis, and a 2D word in here would be the
// leak that lets the axes stop being independent.
export type AxisSide = "after" | "before";

// #2014 — which CORNER of the menu lands on the press point. The 2D word, and
// the one a call site should be reading: it drives BOTH axes, because the
// corner is the thing the operator sees. `computeMenuPosition` is the single
// place that maps it onto the per-axis `AxisSide`.
export type MenuAnchor = "top-left" | "bottom-right";

export type MenuMeasurement = {
  clickX: number;
  clickY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  safeArea: SafeArea;
  anchor: MenuAnchor;
};

export type MenuPlacement = { left: number; top: number };

export function placeAxis(
  click: number,
  size: number,
  start: number,
  end: number,
  prefer: AxisSide,
): number {
  // 🔴 THE ONE BRANCH THAT DOES NOT MIRROR, and the one a reader "tidying up
  // for symmetry" will break. A menu bigger than its interval falls back to the
  // CSS `max-height` + `overflow-y: auto` pair, and THAT box grows down from
  // `top` / right from `left` — so its origin must be the near edge whichever
  // corner was preferred. Mirrored to `end - size` it would put the menu's HEAD
  // above `start`: behind the status bar on a notched iPhone, with the overflow
  // scroll unable to bring it back, which is the #913 defect re-entered here.
  // Derived from the fallback's growth direction, NOT measured on a device —
  // what a device would add is how bad it looks, not whether it happens.
  if (size >= end - start) return start;
  if (prefer === "after") {
    if (click + size <= end) return Math.max(click, start);
    const flipped = click - size;
    return flipped >= start ? flipped : end - size;
  }
  // The mirror of the three collision branches above. The clamps swap sides
  // too: "after" gives up on `end - size`, "before" gives up on `start` —
  // each toward the side it wanted.
  const before = Math.min(click, end) - size;
  if (before >= start) return before;
  // `Math.max` here and not on the branch above: a press can land INSIDE the
  // leading inset, and this arm's flipped coord is the raw click, so without
  // the clamp the box would open from an occluded column. The "after" fit arm
  // already carries the same guard for the same press — the asymmetry is in
  // which arm needs it, not in the policy.
  const after = Math.max(click, start);
  return after + size <= end ? after : start;
}

// The two bounds come from different places and both can bite:
//   * `safeArea` is a laid-out box, so its edges are LAYOUT-viewport
//     coordinates — it knows the notch, and does NOT know the keyboard (iOS
//     never shrinks the layout viewport for it).
//   * `viewport{Width,Height}` is the VISUAL viewport, which knows the
//     keyboard and not the notch. #487 chose it deliberately: `innerHeight`
//     stays full-screen with the keyboard up and would let the menu render
//     underneath it.
// They compose as a plain `min` because both are measured from the layout
// viewport's origin — true while `visualViewport.offsetTop/Left` are 0, which
// holds for this non-scrolling, non-zoomable app shell. A pinch-zoomed page
// would need the offsets added in; the pre-#949 code made the same assumption.
export function computeMenuPosition(m: MenuMeasurement): MenuPlacement {
  // The corner → per-axis translation, in one place. "bottom-right" is
  // `before` on BOTH axes: the box's far edge on the press point is what makes
  // it open up-and-left of the finger.
  const prefer: AxisSide = m.anchor === "bottom-right" ? "before" : "after";
  return {
    left: placeAxis(
      m.clickX,
      m.menuWidth,
      m.safeArea.left,
      Math.min(m.viewportWidth, m.safeArea.right),
      prefer,
    ),
    top: placeAxis(
      m.clickY,
      m.menuHeight,
      m.safeArea.top,
      Math.min(m.viewportHeight, m.safeArea.bottom),
      prefer,
    ),
  };
}

// #588 — max-height cap for a menu that opens UPWARD from a bottom-pinned
// anchor (the rail actions launcher: `.rail-actions-menu { bottom: 100% }`).
// The space such a menu actually has is only what lies ABOVE the anchor —
// NOT the whole viewport, which is what the CSS `max-height:
// var(--viewport-height)` wrongly capped it at (the menu then grew off the
// top of the screen instead of scrolling). `anchorTop` is the anchor's
// distance from the viewport top (getBoundingClientRect().top); `gap` keeps
// a few px clear at the top for breathing room. Clamped at 0: an anchor near
// y=0 must never produce a NEGATIVE max-height (invalid CSS → rule ignored →
// the overflow bug returns). Sibling of `placeAxis`'s viewport-oversize
// pin — both hand the CSS `overflow-y: auto` a valid, in-viewport box.
//
// #913 — the return value is no longer the final max-height: `anchorTop` is
// measured from the layout viewport origin, which under `viewport-fit=cover`
// is BEHIND the status bar, so the caller publishes this as
// `--rail-menu-space-above` and the stylesheet subtracts
// `var(--safe-area-inset-top)` before capping. `gap` is breathing room only —
// it is NOT a notch allowance, and must not be grown into one.
export function spaceAbove(anchorTop: number, gap: number): number {
  return Math.max(0, anchorTop - gap);
}
