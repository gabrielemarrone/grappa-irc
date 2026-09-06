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
import { type CreditsArpeggio, type CreditsPiece, startCreditsArpeggio } from "./lib/creditsAudio";
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
import { creditsRollPass } from "./lib/creditsRoll";
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
  // #1920 reads the same element for the SUITE's cursor (`creditsRollPass`),
  // which is why the declaration sits above the audio effect: both readers
  // close over it, neither runs before it is assigned.
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
    // the titles come back round. It is a THUNK read from the scheduler's own
    // pump, not a signal: the roll's pass lives in the CSS animation, which
    // Solid cannot observe, and polling it into a signal would be the second
    // clock `creditsRain` was careful not to introduce.
    arpeggio = startCreditsArpeggio(new Ctor(), untrack(creditsMuted), () => creditsRollPass(roll));
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

  const versionLabel = (): string => bootBundleVersionAccessor() ?? "version unknown";
  const dateLabel = (): string | null => creditsDateLabel(credits.date);

  return (
    <Show when={creditsModalOpen()}>
      {/* One fixed full-viewport box, not a backdrop plus a centred dialog:
          the rain IS the backdrop, and a separate scrim would sit between
          them. `.credits-modal` is the selector the overlay lock targets. */}
      <div
        class="credits-modal"
        role="dialog"
        aria-modal="true"
        aria-label="credits"
        data-testid="credits-modal"
      >
        <MatrixRain
          class="credits-rain"
          testId="credits-matrix-rain"
          look={() => creditsRainLook(roll, block)}
        />

        <div class="credits-chrome">
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
                advance();
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
                dissolve the ending the reader is being shown. That is also
                what keeps `creditsRain.blockIsFading` answering "no" here —
                there is no animation on the element to read. */}
            <Show when={stage() === "block" || ended()}>
              <div
                class="credits-block"
                classList={{ "credits-block-fading": !ended() }}
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
