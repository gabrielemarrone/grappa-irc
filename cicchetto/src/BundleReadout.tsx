import type { Component } from "solid-js";
import {
  type BundleSkew,
  bootBundleHashAccessor,
  bootBundleVersionAccessor,
  bundleSkew,
  serverBundleHash,
  serverBundleVersion,
} from "./lib/bundleHash";

// Issue 1974 — "which bundle am I running, and which one does the server say
// is deployed?", answered in one place.
//
// All four facts already existed in `lib/bundleHash`; what did not exist was
// anywhere to read them. Before this, `bootBundleVersionAccessor` surfaced in
// the credits roll and the refresh toast, and the server side surfaced
// nowhere at all — so the one question a person chasing a stale
// service-worker cache actually asks had no answer in the UI.
//
// UNGATED, by vjt's ruling (relayed 2026-09-07): the readout lives on the
// settings drawer's main index, not in `AdminDebugTab`. The people who get
// served a stale bundle are ordinary PWA users, and the failure this makes
// visible — `bundleHash.ts` `performRefresh`'s header, where the SW keeps
// serving the OLD precached `index.html` for a reload or three — is only
// observable by watching the running hash NOT move across presses. An
// admin-gated panel cannot host that observation for the population that
// hits it.
//
// NOT the credits modal, which is the only other ungated surface carrying any
// of this: it is an easter egg by its own declaration (`lib/creditsModal.ts`
// header), it is a full-viewport animated end-titles roll with a soundtrack,
// and it renders ONE of the four values as a line that scrolls past.
//
// NO refresh control of its own. Three already exist (`errorBanners.ts` →
// `requestBundleRefreshNow("user")`, `BootErrorBoundary.tsx`, and #674's
// auto-refresh with #775's toast), and the first of those renders on the
// ungated banner stack under EXACTLY the condition that makes a refresh
// actionable here — `shouldShowRefreshBanner()`, which is now literally
// `bundleSkew(...) === "skewed"`. A fourth door would be a second affordance
// for the same verb, live in the same state, three lines apart.

/** Every cell degrades to a word rather than to a blank. */
const UNKNOWN_CELL = "unknown";

/**
 * The verdict line, one per member of the closed set.
 *
 * A `Record` and not a chain of ternaries, so adding a fourth `BundleSkew`
 * member is a compile error here rather than a silently empty line.
 */
const SKEW_COPY: Record<BundleSkew, string> = {
  aligned: "up to date — this tab is running the deployed build",
  skewed: "out of date — this tab is still running an older build",
  unknown: "not compared — the server has not announced a build yet",
};

const cell = (value: string | null): string => value ?? UNKNOWN_CELL;

const BundleReadout: Component = () => {
  // Computed from the SAME two reads the table prints, not from a second
  // signal read: the verdict and the values it is a verdict about can then
  // never disagree, which on a diagnosis surface is the whole point.
  const skew = (): BundleSkew => bundleSkew(bootBundleHashAccessor(), serverBundleHash());

  return (
    <section
      class="settings-section settings-section-card settings-build"
      data-testid="settings-build"
      data-skew={skew()}
    >
      <h4 class="settings-section-heading">build</h4>
      {/* A real table, not a stack of lines: the reader's question is a
          COMPARISON down a column, and the trivial-rebuild case #292 names —
          same semver, different hash — is only legible when the two hashes sit
          one above the other. The hashes are printed WHOLE; `versionLabel`
          truncates to `SHORT_HASH_LEN` (7) to keep a sentence readable, and
          vite's hash is 8 characters, so borrowing that formatter would drop
          the last character of the two values being compared. */}
      <table class="settings-build-table">
        <thead>
          <tr>
            <td class="settings-build-corner" />
            <th scope="col">running</th>
            <th scope="col">deployed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">version</th>
            <td data-testid="settings-build-running-version">
              {cell(bootBundleVersionAccessor())}
            </td>
            <td data-testid="settings-build-deployed-version">{cell(serverBundleVersion())}</td>
          </tr>
          <tr>
            <th scope="row">build hash</th>
            <td data-testid="settings-build-running-hash">{cell(bootBundleHashAccessor())}</td>
            <td data-testid="settings-build-deployed-hash">{cell(serverBundleHash())}</td>
          </tr>
        </tbody>
      </table>
      <p class="settings-section-blurb" data-testid="settings-build-skew">
        {SKEW_COPY[skew()]}
      </p>
    </section>
  );
};

export default BundleReadout;
