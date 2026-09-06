import {
  type Component,
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { buildCredits, creditsDateLabel } from "./lib/buildCredits";
import { bootBundleVersionAccessor } from "./lib/bundleHash";
import {
  type CreditsArpeggio,
  type CreditsPiece,
  creditsMovementName,
  startCreditsArpeggio,
} from "./lib/creditsAudio";
import { CREDITS_COW, CREDITS_SPECIAL_THANKS } from "./lib/creditsBlock";
import {
  CREDITS_CLOSE_LABEL,
  CREDITS_FINALE_LINE,
  CREDITS_HEART,
  CREDITS_MANIFESTO,
  CREDITS_MANIFESTO_ATTRIBUTION,
} from "./lib/creditsFinale";
import {
  closeCreditsModal,
  creditsModalOpen,
  creditsMuted,
  toggleCreditsMuted,
} from "./lib/creditsModal";
import { createProseDeck, type ProseSet } from "./lib/creditsProse";
import { creditsRainLook } from "./lib/creditsRain";
import { createOverlayLock } from "./lib/overlayScrollLock";
import MatrixRain from "./MatrixRain";

// #1773 — the credits easter egg: falling characters behind an end-titles
// roll, on a loop, with a synthesised soundtrack.
//
// Mounted in Shell, not in SettingsDrawer, and that is structural rather than
// tidiness: `.settings-drawer` animates on `transform`, which makes it the
// containing block for any `position: fixed` descendant — a full-screen modal
// rendered inside it would be clipped to the drawer. Same reason
// ShareSessionModal, opened from the same drawer, lives in Shell.
//
// `createOverlayLock`, NOT `createOverlayEscape`: this covers the whole
// viewport, so without the scroll-lock refcount the iOS shell pans behind it
// (the live #1772 bug). The scrollback freeze the lock also brings is WANTED
// here for the same reason — nothing of the pane is visible to keep live.
//
// Every fact on screen comes from a source that already existed:
//   * the version from `<meta name="cicchetto-version">` via
//     `bundleHash.bootBundleVersionAccessor` (#292 — ONE injection point, and
//     a second carrier is the drift #538 closed);
//   * the sha, its date and the contributor list from `buildCredits()`, baked
//     by infra/packaging/credits.sh through the same wrapper channel.
//
// Both degrade to "unknown" rather than to blank. A build genuinely can have
// no git — the AUR source tarball and the release image both do — and a roll
// that renders an empty line there reads as a bug in the modal rather than as
// the truth about the build.

/**
 * Where the credits are in their sequence (#1931).
 *
 * A closed set rather than a number: "the deck is spent" and "this is the
 * ending" are states, not counts, and expressing them as arithmetic on the
 * pass index would make two different facts share one variable.
 */
type CreditsStage = "block" | "prose" | "manifesto" | "finale";

/** Which piece of the soundtrack belongs under each stage. */
function pieceFor(stage: CreditsStage): CreditsPiece {
  if (stage === "manifesto") return "manifesto";
  if (stage === "finale") return "cadence";
  return "suite";
}

const CreditsModal: Component = () => {
  createOverlayLock(() => creditsModalOpen(), ".credits-modal", closeCreditsModal);

  const credits = buildCredits();

  // #1807 — the roll's own animation is the ONLY clock. `MatrixRain` calls
  // `look` once per drawn frame from inside the loop it already runs, and
  // `creditsRainLook` answers by reading this element's animation phase, so
  // the burst can never drift away from the interlude it belongs to. Assigned
  // during element creation, which is before any `onMount` — including the
  // one that starts the rain — so the loop never sees it unset.
  //
  // The declaration sits above the audio effect because that effect closes
  // over it too; neither reader runs before it is assigned.
  let roll: HTMLDivElement | undefined;

  // #1929 — the first block's own element, and the second thing the rain
  // reads. It carries `credits-block-fade`, so its phase is what tells
  // `creditsRainLook` the dissolve has started; the roll's phase alone cannot,
  // because the roll is still travelling at that point.
  //
  // A SEPARATE ref rather than a subtree lookup: `roll.getAnimations({subtree:
  // true})` would return both animations and the existing readers index `[0]`,
  // so the two would start depending on an unspecified order.
  //
  // Reassigned to `undefined` when the block goes, because after the first
  // pass there genuinely is no block — a stale reference would keep the rain
  // bursting off a dead element's filled-forwards animation.
  let block: HTMLDivElement | undefined;

  // ── prose between the passes (#1924) ────────────────────────────────────
  // A THIRD reader of the same animation, and deliberately not a third clock:
  // `animationiteration` is the roll telling us it has come back round, so the
  // paragraph turns over at the exact frame the column jumps back below the
  // fold — the one moment in the cycle where swapping text is invisible,
  // because the block is off-screen while it changes.
  //
  // The deck lives for the session rather than per open: it is what keeps the
  // sets from repeating, and rebuilding it on every open would re-deal from a
  // full bag and hand you the set you just watched.
  const deck = createProseDeck();
  const [prose, setProse] = createSignal<ProseSet | null>(null);

  // ── the sequence, and where in it we are (#1931) ────────────────────────
  // vjt's order, end to end: the block (names, cow, thanks) → prose sets until
  // the deck has dealt every one → the manifesto → the credits once more, with
  // a pulsing heart, a closing line and a button. The roll's own
  // `animationiteration` walks it; there is no clock here.
  //
  // A STAGE rather than the pass counter this replaces. The pass number could
  // say "show the names" (pass zero) and nothing else: it cannot express "the
  // deck is spent", which is the trigger the ending hangs off, and it cannot
  // tell the manifesto from the finale. Both of those would have become
  // arithmetic on a number that means something else.
  const [stage, setStage] = createSignal<CreditsStage>("block");

  // The deck reported its bag empty and the ending has not run yet.
  //
  // Session-scoped (a plain `let` in a component Shell mounts once), for the
  // same reason the deck itself is: vjt wants the ending reachable ACROSS
  // several viewings, so closing the modal one set short must not throw the
  // progress away. It is a pending NOTIFICATION and not a copy of
  // `deck.exhausted()` — the deck reports an edge on the draw that empties the
  // bag, and the ending is two turnovers later, so something has to hold it in
  // between. Cleared when the finale arrives, which is what lets a NEW opening
  // after a completed run start a fresh run instead of ending immediately.
  let endingDue = false;

  /**
   * One turn of the roll. The ORDER of these branches is the guarantee vjt
   * asked for — that the ending can never appear before the last set.
   *
   * The finale holds: once it is up, later turnovers do nothing, because the
   * roll is stopped and there is nothing after the end.
   */
  const advance = (): void => {
    const now = stage();
    if (now === "finale") return;
    if (now === "manifesto") {
      setStage("finale");
      // Consumed HERE and not on the way in: while it is set, a reopening
      // resumes the ending rather than restarting the sequence. Clearing it
      // is what tells the next opening that this run is over.
      endingDue = false;
      return;
    }
    if (endingDue) {
      // No draw. The bag is spent, and drawing here would refill it and hand
      // out a seventeenth set nobody asked for, one turn before the end.
      setStage("manifesto");
      return;
    }
    setProse(deck.draw());
    setStage("prose");
    // Read AFTER the draw, which is the only moment the edge exists: the deck
    // reports the bag empty for exactly the window between this draw and the
    // next one.
    if (deck.exhausted()) endingDue = true;
  };

  /** Is the sequence over? The roll stops, and the rain settles with it. */
  const ended = (): boolean => stage() === "finale";

  // ── the suite's cursor ──────────────────────────────────────────────────
  // Which pass of the roll is on screen: 0 during the block, 1 on the first
  // prose set, and so on. It is what walks the soundtrack from one movement
  // to the next.
  //
  // #1920 read this off the animation itself — `getComputedTiming().
  // currentIteration` — precisely so there would be no second count to drift.
  // That stopped being true the moment the roll had to be RESTARTED on every
  // turn to re-resolve its keyframes against the new set's height (11:02):
  // a restart is a new animation, its iteration count begins at zero again,
  // and the suite sat on movement one for ever. vjt, #grappa 11:10: "ci siamo
  // persi il cambio di musichette tra un cambio e l'altro".
  //
  // Counting `animationiteration` is NOT the second clock the old comment
  // warned about. That warning was about a `setInterval` — a timer that keeps
  // running while a backgrounded tab freezes the animation. This increments
  // on the roll's own event, so it advances when the roll advances and stalls
  // when the roll stalls, which is exactly what reading `currentIteration`
  // bought us. What it does NOT do is reset when we restart the element.
  let rollPass = 0;

  // #1934 — the movement's name, shown next to the speaker while the music is
  // ON. vjt, reporting a click between notes: "non so dirti quale sia la song".
  // The suite turns over with the roll, so by the time anyone can describe what
  // they heard it is playing something else — the label is what makes a report
  // name a movement. A signal, unlike `rollPass`, because this one is rendered.
  const [movementName, setMovementName] = createSignal(creditsMovementName(0));

  createEffect(() => {
    // #1929 — CLEARED on open, not drawn. The first pass is the block (names,
    // cow, thanks) and carries no prose at all, so a set drawn here would be
    // dealt out of the bag and never seen: the first `animationiteration`
    // replaces it before it is ever on screen. Drawing lazily is what keeps
    // the deck's no-repeat promise honest.
    //
    // The stage resets with it: `Show` builds a fresh element on every open, so
    // its animation genuinely starts over, and carrying the old stage would
    // hide the block from the second viewing onwards.
    //
    // #1931 — `endingDue` deliberately does NOT reset here. That flag is the
    // deck's progress, and the deck is session-scoped precisely so the ending
    // can be reached across several openings.
    if (creditsModalOpen()) {
      setStage("block");
      setProse(null);
      setMovementName(creditsMovementName(0));
      // With the stage: `Show` builds a fresh element on every open, so the
      // roll genuinely starts from pass zero and the suite has to as well.
      rollPass = 0;
    }
  });

  // ── soundtrack lifecycle ────────────────────────────────────────────────
  // Tied to the OPEN signal, not to this component's mount: Shell mounts the
  // component for the whole session, so an onMount-scoped context would be
  // built at boot (before any gesture) and would outlive every close.
  let arpeggio: CreditsArpeggio | null = null;
  const stopArpeggio = (): void => {
    arpeggio?.stop();
    arpeggio = null;
  };

  createEffect(() => {
    if (!creditsModalOpen()) {
      stopArpeggio();
      return;
    }
    if (arpeggio !== null) return;
    // jsdom has no WebAudio, and neither does a browser with it disabled —
    // a silent modal, not a broken one. `webkitAudioContext` is still what
    // older iOS Safari exposes.
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    // `untrack`: the initial mute state is an INPUT to construction, not a
    // dependency of it. Tracked, a mute toggle would re-run this effect for
    // nothing — the separate effect below is what carries a live toggle.
    //
    // #1920 — the third argument is what makes the soundtrack turn over when
    // the titles come back round. A THUNK read from the scheduler's own pump
    // rather than a signal: the scheduler wants the pass at the instant it
    // arms a bar, and nothing RENDERS the number, so a signal would buy a
    // reactive hop and no reader. See `rollPass` for why it is a count and no
    // longer a read of the animation's own iteration.
    arpeggio = startCreditsArpeggio(new Ctor(), untrack(creditsMuted), () => rollPass);
  });

  createEffect(() => {
    const muted = creditsMuted();
    arpeggio?.setMuted(muted);
  });

  // #1931 — the soundtrack follows the SEQUENCE, and this one is a signal
  // rather than the thunk `movementAt` is. The distinction is real: the roll's
  // pass lives in a CSS animation Solid cannot observe, so reading it has to
  // be a poll from the scheduler's own pump; the stage is Solid state that
  // changes exactly when the sequence moves, so an effect is the honest
  // mechanism and a poll would be the invented clock.
  //
  // `setPiece` is idempotent, which is what makes this safe against the
  // re-runs an effect gets for reasons of its own.
  createEffect(() => {
    arpeggio?.setPiece(pieceFor(stage()));
  });

  // A logout unmounts Shell with the modal still open; without this the
  // context survives the session that opened it.
  onCleanup(stopArpeggio);

  // THE TOUCHDOWN JUMP — and the hold is not its cause. Measured frame by
  // frame on vjt's recording: at the frame `playState` flips to `paused` the
  // content drops 90px while `getBoundingClientRect().top` moves by ONE. A
  // shift the layout does not see is a shift that did not happen in the
  // layout: it happened in the COMPOSITOR's copy of the animation, which had
  // been running against a stale endpoint.
  //
  // `translateY(-100%)` resolves against the roll's OWN border box, and that
  // box is a different size on every turn — the opening block measured 1096px
  // where a set of prose measures 563px. The arithmetic closes: at t=43249,
  // 22.13% into the travel, `894 - 0.2213 * (894 + 563)` = 572, exactly the
  // top the HUD read, while the same instant against the old 1096 sits at 454
  // — the ~118px the picture was out by. The compositor keeps animating to the
  // endpoint it resolved before the turn until something makes it re-resolve,
  // and pausing is such a thing. The hold REVEALS the drift; it does not make
  // it. That is the "ma non sempre".
  //
  // So the distance stops being a percentage. It is measured at the turn,
  // written in px into a custom property, and the animation is restarted right
  // there so the compositor rebuilds its keyframes from the new number. The
  // restart costs nothing because it lands ON the iteration boundary, where
  // the animation was starting over of its own accord anyway.
  // And the SAME measurement fixes the second complaint, vjt's "cresce col
  // passare del tempo": with a fixed 36s cycle a short set and a tall one
  // travel different distances in the same time, so every turn reads at its
  // own pace — 61 px/s measured against 44 on the recording. The eye notices
  // that far more than it notices an absolute speed. So the SPEED is the
  // constant and the duration follows the distance; 44.5 px/s is what the
  // 36s cycle came to on a prose set, i.e. the pace vjt tuned this morning,
  // kept as the number the rest is derived from.
  // vjt, #grappa 11:00: "velocizza in modo che il primo set credits sia 35s".
  // That is an order about a DURATION, and the pace is what has to give — but
  // a hardcoded px/s cannot honour it, because the first set's travel is
  // `its own height + the viewport` and both are the reader's device, not
  // ours. 60 px/s is 35s on one phone and 44s on another.
  //
  // So the constant is derived, not written: the FIRST measurement — the
  // credits block, which is always the first set — solves for the pace that
  // makes ITS cycle 35s, and every later set reuses that number. Both of
  // vjt's rules hold at once, on any screen: the opening set lasts 35s, and
  // the speed is constant from there (10:52, "si riproporziona").
  //
  // vjt, #grappa 11:26: "dobbiamo rallentare i paragrafi lunghi e velocizzare
  // quelli corti, ma con un cap all'altezza schermo altrimenti l'ultimo para
  // di the mentor scrolla troppo lento". So the constant speed of 10:52 was
  // right about the SEAMS and wrong about the reading: a long set and a short
  // one are not the same amount to read, and the long one going past at the
  // short one's pace is the complaint. Speed now falls as the set grows —
  // which is the opposite of what a fixed cycle did, where a long set went
  // FASTER — and the fall is capped, because past a screenful the reader is
  // scrolling rather than taking it in at a glance and more time buys nothing.
  //
  // The cap is the SCREEN, not a pixel count: `min(h, vh)`. That is vjt's cap
  // and it is also the only length that means anything here, since a set
  // taller than the viewport is never on screen all at once anyway.
  const FIRST_SET_SECONDS = 35;
  // The share of the cycle spent travelling — the rest is the interlude, and
  // 0.91 is the park offset the keyframes and the fade both agree on.
  const ROLL_TRAVEL_SHARE = 0.91;
  /**
   * How much slower a set as tall as the screen (or taller) runs than one of
   * no height at all. 1 would be the constant speed this replaces.
   */
  const READ_SLOWDOWN = 1.6;
  /** The reading factor of a set `h` tall on a `vh` screen — `[1, READ_SLOWDOWN]`. */
  const readSlowdown = (h: number, vh: number): number =>
    1 + (READ_SLOWDOWN - 1) * (Math.min(h, vh) / vh);
  /**
   * How much slower prose runs than the credits block it is paced against.
   *
   * vjt, #grappa 11:54: "i blocchi di testo lunghi sono ancora troppo veloci,
   * rallentiamoli ancora un po'". Raising `READ_SLOWDOWN` would NOT have done
   * it, and the reason is arithmetic rather than taste: the pace is solved
   * from the first set, so a later set's cycle is
   * `35 * ((h + vh) * f) / ((h1 + vh) * f1)` — and the credits block is itself
   * taller than the screen (measured 1096 against a 894 viewport), so it sits
   * at the cap. Every set that is ALSO taller than the screen — i.e. every
   * long one, the ones vjt is complaining about — has `f = f1`, the factor
   * cancels, and the constant washes out entirely. It only ever moved the
   * SHORT sets, and moved them the wrong way.
   *
   * So the long sets need a term the first set does not have. The credits
   * block keeps `FIRST_SET_SECONDS` exactly (11:10, "ok timing perfetti"),
   * and everything after it reads slower by this much. The two are different
   * things to read at the same height anyway: the block is a sparse list of
   * names, prose is packed paragraphs, and pixels per second is not words per
   * second between them.
   */
  const PROSE_PACE = 1.3;
  // Latched by the first measurement, then constant for the rest of the run.
  // It is a pace with the reading factor DIVIDED OUT, so that factor can be
  // re-applied per set: latching the first set's own speed would carry that
  // set's height into every later one.
  let rollSpeedPxPerS = 0;
  let lastMeasure = "";
  const syncRollDistance = (node: HTMLElement): void => {
    // A frame later: the turn has just swapped the DOM, and the height that
    // matters is the one AFTER Solid has rendered the new set.
    requestAnimationFrame(() => {
      const h = Math.round(node.getBoundingClientRect().height);
      const vh = Math.round(window.innerHeight);
      if (h <= 0 || vh <= 0) return;
      // The viewport is half the distance, so it belongs in the key: a set of
      // the same height on a rotated screen is a different journey.
      const key = `${h}x${vh}`;
      if (key === lastMeasure) return;
      lastMeasure = key;
      // First measurement solves for the pace; every later one just uses it.
      // The first set's own reading factor is divided out here and multiplied
      // back in below, so the credits block still lasts `FIRST_SET_SECONDS`
      // exactly while every other set is timed against the same pace.
      if (rollSpeedPxPerS === 0) {
        rollSpeedPxPerS = ((h + vh) * readSlowdown(h, vh)) / FIRST_SET_SECONDS / ROLL_TRAVEL_SHARE;
      }
      // Which SET is showing, not which measurement this is: rotating the
      // phone during the credits block re-measures it, and that re-measure
      // must still be the block, on the block's own clock.
      const pace = rollPass === 0 ? 1 : PROSE_PACE;
      const cycle = (((h + vh) * readSlowdown(h, vh)) / rollSpeedPxPerS / ROLL_TRAVEL_SHARE) * pace;
      node.style.setProperty("--credits-roll-h", `${h}px`);
      // Restart, or the compositor keeps the keyframes it already resolved and
      // the new number changes nothing until the next unrelated recalc.
      node.style.animation = "none";
      void node.offsetHeight;
      node.style.animation = "";
      // After the shorthand is cleared, or clearing it would take this with it.
      node.style.animationDuration = `${cycle.toFixed(2)}s`;
      // vjt, #grappa 10:56: "il testo fa fadeout prima di scrollare tutto su".
      // The fade is a SECOND animation, on the block inside this node, and the
      // stylesheet gives the two the same 36s precisely so they cannot drift.
      // The moment the roll's duration became a measurement, that guarantee
      // died with it: the block kept 36s while the roll ran the cycle its own
      // height bought it — ~47s for the credits block — so the dissolve
      // finished at ~77% of the travel with a quarter of the list still on
      // screen. One clock means BOTH clocks, so the block gets the number too,
      // and the same restart, so they also share a phase and not just a period.
      const block = node.querySelector<HTMLElement>(".credits-block-fading");
      if (block) {
        block.style.animation = "none";
        void block.offsetHeight;
        block.style.animation = "";
        block.style.animationDuration = `${cycle.toFixed(2)}s`;
      }
    });
  };

  // #1934 — hold to read. vjt: "ontouchdown lo scroll si stoppa così se
  // qualcuno vuol leggere e non ha finito può farlo". A HOLD and not a toggle,
  // because that is what a finger on a moving line means; the stop lasts
  // exactly as long as the contact does.
  //
  // Pointer events, not touch ones: the same gesture is a mouse press on a
  // desktop, and `pointerdown` is the one name that covers both. `.credits-
  // modal` carries `touch-action: none` already, so the browser has no
  // competing pan gesture to claim the sequence for itself.
  //
  // The stop itself is CSS (`animation-play-state`, see default.css): the
  // roll's animation is the only clock in this file, and pausing IT is what
  // keeps the rain, the paragraph turn and the fade agreeing while the reader
  // holds. A JS pause would need all three paused with it.
  const [held, setHeld] = createSignal(false);

  // A LOST RELEASE IS THE FAILURE MODE, and it is not hypothetical: it is what
  // vjt's screen recording shows. Measured frame by frame at 60fps, the roll
  // sits at exactly the same offset for 0.850s — dead still, not slow — and
  // then starts moving at ~33px/s and never stops again. A roll that stands
  // still is a roll that is PAUSED (`credits-roll` is `infinite` and its only
  // stationary phase parks it off the top of the viewport, where nothing of it
  // is visible), so the hold was already latched when the recording began, and
  // what the touch in it did was END that hold. From the reader's side that
  // reads exactly as vjt described it: touch the screen, the text scrolls.
  //
  // So the bug is the release that never arrived from the gesture BEFORE, and
  // "ma non sempre" is the signature of one: a lift that the page is not told
  // about leaves `held` true, and the next tap is what clears it.
  //
  // POINTER CAPTURE is the fix, rather than a longer list of events to listen
  // for. Capturing on `pointerdown` makes this element the target of the rest
  // of that pointer's sequence wherever it goes, and guarantees a terminating
  // event — `pointerup` or `pointercancel`, and `lostpointercapture` if the
  // browser takes the capture away — instead of hoping one of them lands here.
  //
  // The id is tracked because a second finger must not be able to release the
  // first one's hold: the hold belongs to the pointer that started it.
  let heldPointer: number | null = null;

  const grab = (event: PointerEvent): void => {
    // Second finger while one is already holding: nothing to do. Re-capturing
    // would move the capture onto the new pointer and hand the release to a
    // finger that never took the hold.
    if (heldPointer !== null) return;
    heldPointer = event.pointerId;
    const target = event.currentTarget as HTMLElement;
    // Guarded: jsdom has no pointer capture, and the tests drive this handler.
    target.setPointerCapture?.(event.pointerId);
    setHeld(true);
  };

  const release = (event?: PointerEvent): void => {
    if (event && heldPointer !== null && event.pointerId !== heldPointer) return;
    heldPointer = null;
    setHeld(false);
  };

  // The backstop for the case capture cannot cover: the app going away
  // mid-hold (task switcher, lock button, a call). iOS does not always deliver
  // a pointer event on the way out, and a roll left frozen behind a hidden tab
  // is exactly the state this whole comment is about.
  const releaseOnHide = (): void => {
    if (document.visibilityState === "hidden") release();
  };
  document.addEventListener("visibilitychange", releaseOnHide);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", releaseOnHide);
  });

  const versionLabel = (): string => bootBundleVersionAccessor() ?? "version unknown";
  const dateLabel = (): string | null => creditsDateLabel(credits.date);

  return (
    <Show when={creditsModalOpen()}>
      {/* One fixed full-viewport box, not a backdrop plus a centred dialog:
          the rain IS the backdrop, and a separate scrim would sit between
          them. `.credits-modal` is the selector the overlay lock targets. */}
      <div
        class="credits-modal"
        classList={{ "credits-modal-held": held() }}
        role="dialog"
        aria-modal="true"
        aria-label="credits"
        data-testid="credits-modal"
        onPointerDown={grab}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <MatrixRain
          class="credits-rain"
          testId="credits-matrix-rain"
          look={() => creditsRainLook(roll, block)}
        />

        <div class="credits-chrome">
          {/* Only while the music is audible: muted, the name would be naming
              something nobody can hear. Ahead of the speaker so it reads as a
              label ON it rather than a stray word between two buttons. */}
          <Show when={!creditsMuted()}>
            <span class="credits-movement" data-testid="credits-movement">
              {movementName()}
            </span>
          </Show>
          <button
            type="button"
            class="modal-chrome-button credits-mute"
            data-testid="credits-mute"
            aria-pressed={creditsMuted()}
            aria-label={creditsMuted() ? "unmute credits music" : "mute credits music"}
            onClick={toggleCreditsMuted}
          >
            {creditsMuted() ? "🔇" : "🔊"}
          </button>
          <button
            type="button"
            class="modal-chrome-button credits-close"
            data-testid="credits-close"
            aria-label="close credits"
            onClick={closeCreditsModal}
          >
            ×
          </button>
        </div>

        {/* The roll scrolls by CSS animation, so the loop costs no frame
            budget of ours and `prefers-reduced-motion` can turn it into a
            plain scrollable column with one media query — see default.css.
            #1807 lengthened the cycle and parked the translate before its
            end; that tail IS the interlude, and it is read back off this
            element rather than counted a second time in JS. */}
        <div class="credits-viewport" classList={{ "credits-viewport-ended": ended() }}>
          <div
            class="credits-roll"
            classList={{ "credits-roll-ended": ended() }}
            data-testid="credits-roll"
            ref={(node) => {
              roll = node;
              // The first set needs the number too: without this the opening
              // pass runs on the `100%` fallback, which is the very percentage
              // this is here to stop depending on.
              syncRollDistance(node);
              // #1924 — no `onCleanup`, and that is not an omission: the
              // listener is on THIS element, `Show` discards the element on
              // close, and a listener on a discarded node is collected with
              // it. Registering a teardown would be teardown for a thing that
              // cannot outlive what it is attached to.
              //
              // `event.target === node` because `animationiteration` bubbles:
              // any future animated descendant of the roll would otherwise
              // turn the paragraph over on its own schedule.
              node.addEventListener("animationiteration", (event) => {
                if (event.target !== node) return;
                // The suite's cursor moves FIRST, and the order matters: the
                // restart inside `syncRollDistance` wipes the animation's own
                // iteration count, so this is now the only thing that
                // remembers how many turns the roll has taken.
                rollPass += 1;
                setMovementName(creditsMovementName(rollPass));
                advance();
                syncRollDistance(node);
              });
            }}
          >
            {/* #1924 — the names are a FIRST-PASS thing. vjt: "mostriamo i
                credits una volta sola, chi se ne frega di ri-vederli, e poi
                solo i paragrafi, con i relativi titoli." A loop that re-runs
                the same list every 34s teaches the viewer to stop reading,
                which is the surest way to make the prose invisible too.

                #1929 — and they are not alone in it: the titles, the
                contributors, the cow and the special thanks are ONE block, the
                first one, which ends in a fade. So the wrapper is not
                decorative — it is the element carrying `credits-block-fade`,
                and it is what dissolves and what the rain reads. Putting that
                animation on the roll instead would fade the prose too, for
                ever, since the roll outlives the block.

                The DOM swap still rides `animationiteration`, i.e. it lands a
                full interlude after the fade has finished: by then the block
                is transparent AND parked off the top, so what is removed has
                been invisible twice over.

                #1931 — and the block COMES BACK for the finale, which is why
                the condition is a stage and not a pass number. It comes back
                WITHOUT `credits-block-fading`: the fade is a one-shot with
                `forwards`, so a re-mounted element would restart it and
                dissolve the ending the reader is being shown.

                It comes back with `credits-block-returning` instead (vjt,
                #grappa 11:26: "alla chiusura i credit dovrebbero riapparire
                fade in e non tutt'una volta") — a one-shot fade IN. That one
                still keeps `creditsRain.blockIsFading` answering "no", because
                its first keyframe is transparent and `fadeOffset` gives up on
                the first stop that is not fully opaque. */}
            <Show when={stage() === "block" || ended()}>
              <div
                class="credits-block"
                classList={{
                  "credits-block-fading": !ended(),
                  "credits-block-returning": ended(),
                }}
                data-testid="credits-block"
                ref={(node) => {
                  block = node;
                  // A detached element reports no animations, so a stale ref
                  // would already answer "not fading" — this is here to make
                  // the lifetime explicit rather than to rely on that.
                  onCleanup(() => {
                    block = undefined;
                  });
                }}
              >
                <h2 class="credits-title" data-testid="credits-title">
                  GRAPPA IRC
                </h2>
                <p class="credits-version" data-testid="credits-version">
                  {versionLabel()}
                </p>
                <p class="credits-build" data-testid="credits-build">
                  <span data-testid="credits-sha">{credits.sha ?? "no build sha"}</span>
                  <Show when={dateLabel()}>
                    {(day) => (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span data-testid="credits-date">{day()}</span>
                      </>
                    )}
                  </Show>
                </p>

                <h3 class="credits-heading">contributors</h3>
                <ul class="credits-list">
                  <For
                    each={credits.contributors}
                    fallback={
                      // Honest, not blank: this is what a build from a source
                      // tarball looks like, and it is a legitimate build.
                      <li class="credits-empty" data-testid="credits-empty">
                        this build carries no history
                      </li>
                    }
                  >
                    {(person) => (
                      <li class="credits-person" data-testid="credits-person">
                        <span class="credits-person-name">
                          {person.nick ?? person.name}
                          {/*
                            The real name is a parenthetical to the handle, and
                            only when it says something the handle does not: for
                            Lucy, or for a bot committing under its own handle,
                            the two are the same string and "Lucy (Lucy)" would
                            be noise. Nobody in the table, no nick — the bare
                            name above is already the whole row.
                          */}
                          <Show when={person.nick !== null && person.nick !== person.name}>
                            {" "}
                            (<em class="credits-person-realname">{person.name}</em>)
                          </Show>
                        </span>
                        <span class="credits-person-count">{person.commits}</span>
                      </li>
                    )}
                  </For>
                </ul>

                {/* Azzurra's own Super Cow, from bahamut's `/info`. A `pre`
                    because it is fixed-width art: the glyphs mean nothing
                    except in the columns they were drawn in. */}
                <pre class="credits-cow" data-testid="credits-cow">
                  {CREDITS_COW}
                </pre>

                {/* Dictated by vjt, verbatim — see `creditsBlock.ts`. The
                    dash is `aria-hidden` for the reason the build separator
                    above is: it is punctuation between two fields, and a
                    screen reader announcing it reads as a word. */}
                <h3 class="credits-heading">special thanks</h3>
                <ul class="credits-thanks">
                  <For each={CREDITS_SPECIAL_THANKS}>
                    {(entry) => (
                      <li data-testid="credits-thanks">
                        <span class="credits-thanks-who">{entry.who}</span>
                        <span aria-hidden="true"> — </span>
                        <span class="credits-thanks-why">{entry.why}</span>
                      </li>
                    )}
                  </For>
                </ul>

                {/* The coda closes the block for the same reason it used to
                    close the names: it is a tagline, and a tagline on a loop
                    stops being read and starts being a boast. */}
                <p class="credits-coda">
                  an always-on IRC bouncer, and a client that looks like irssi
                </p>

                {/* #1931 — the ending, INSIDE the block that came back rather
                    than beside it: vjt's sequence is "credits di nuovo + cuore
                    + riga + bottone", one last screen and not two. */}
                <Show when={ended()}>
                  <p class="credits-heart" data-testid="credits-heart" aria-hidden="true">
                    {CREDITS_HEART}
                  </p>
                  <p class="credits-finale-line" data-testid="credits-finale-line">
                    {CREDITS_FINALE_LINE}
                  </p>
                  {/* Closes through `closeCreditsModal`, the SAME function the
                      overlay lock is given and the ✕ in the chrome calls. A
                      second closing path would be a second place for the
                      scroll-lock refcount to be got wrong, which is the live
                      #1772 bug this modal already had once. */}
                  <button
                    type="button"
                    class="credits-close-cta"
                    data-testid="credits-close-cta"
                    onClick={closeCreditsModal}
                  >
                    {CREDITS_CLOSE_LABEL}
                  </button>
                </Show>
              </div>
            </Show>

            {/* #1931 — the manifesto, between the last set and the ending.
                Its own block rather than a seventeenth prose set: it is ~570
                words against a 300-word cap, and the cheap way to fit it would
                be to raise the cap, which would silently un-bound all sixteen
                sets the cap exists to keep readable.

                The text ships on vjt's own clearance (2026-09-06) — see
                `creditsFinale.ts` for the decision and whose it was. The
                attribution renders beside it, not after it, because a credit
                added in a follow-up is a credit that never ships. */}
            <Show when={stage() === "manifesto"}>
              <div class="credits-manifesto" data-testid="credits-manifesto">
                <p class="credits-manifesto-text">{CREDITS_MANIFESTO}</p>
                <p class="credits-manifesto-attribution" data-testid="credits-manifesto-credit">
                  {CREDITS_MANIFESTO_ATTRIBUTION}
                </p>
              </div>
            </Show>

            {/* #1924 — inside the column, so a paragraph enters through the
                bottom of the viewport rather than cutting to a second screen.

                #1929 — but NOT during the first pass any more. The block is
                the first thing and the prose is what comes after it, so the
                gate is on the stage and not merely on there being a set: the
                two used to share the column, and the block would otherwise be
                trailed by a paragraph it is supposed to hand over to.

                #1931 — the same gate now also keeps the last set off the
                manifesto's screen and off the ending's. `prose()` outlives the
                stage that drew it, on purpose: it is what the reader was last
                shown, and clearing it would be state kept for the benefit of
                a condition that can already read the stage. */}
            <Show when={stage() === "prose" && prose()}>
              {(set) => (
                <div class="credits-prose" data-testid="credits-prose">
                  <h3 class="credits-prose-title" data-testid="credits-prose-title">
                    {set().title}
                  </h3>
                  <For each={set().paragraphs}>{(paragraph) => <p>{paragraph}</p>}</For>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default CreditsModal;
