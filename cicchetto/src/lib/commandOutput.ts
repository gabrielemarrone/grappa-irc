import { createSignal } from "solid-js";
import type { ChannelKey } from "./channelKey";
import { identityScopedStore } from "./identityScopedStore";

// #162 — the in-window answer of a slash verb. Append-only list of plain
// text lines per SUBMITTING window key, one entry per LINE.
//
// Why a store, and why a THIRD one next to `inviteAck` and `topicShow`: a
// verb that answers a question (`/ignore` — what is ignored here?) or
// reports what it did (`/unignore spambot` — removed `spambot!*@*`, a mask
// the operator never typed) belongs in the window, irssi-style, where the
// answer stays as a log of what was asked and when. The `{ ok: string }`
// compose notice is a transient strip under the composer that auto-dismisses
// and shows one line: it cannot carry a list, and it cannot carry history
// (Gabriele's ruling, 2026-09-06). `topicShow` is the same idea for one
// structured answer (the topic renders with its setter meta); this one is
// the plain-text general case, so a future verb reaches for it rather than
// growing a fourth store.
//
// Display rules, shared with the two siblings:
//   * Keyed by the SUBMITTING window. The answer lands where the operator
//     typed, which is where they are looking.
//   * One row per line, rows accumulate in ask order. Asking twice prints
//     twice: a log, not a last-write-wins banner.
//   * NOT persisted — an answer to a question just asked, not audit log.
//   * Interleaved by wallclock `at` in the pane's `rows()` memo, so the
//     answer sits at the moment it was given rather than pinned to the
//     bottom where later arrivals would read as replies to it.
//
// Identity-scoped: cleared on logout / token rotation, like every other
// client-side buffer.

/**
 * One line of an answer, as the handler shapes it. A `label` renders in the
 * accent style of `Topic for #chan:` (so `Ignore list for azzurra:`,
 * `Unignore:`), an `indent`ed line is a member of the list the label opened
 * — one mask per row under the header, irssi-style (Gabriele, 2026-09-06).
 */
export type CommandOutputLine = {
  label: string | null;
  text: string;
  indent: boolean;
};

export type CommandOutputEntry = CommandOutputLine & {
  /**
   * Monotonic insertion sequence (closure-local counter, NOT a clock).
   * Tiebreaker for lines of one invocation, which all share an `at`.
   */
  ts: number;
  /** Wallclock epoch ms — the sort key against `ScrollbackMessage.server_time`. */
  at: number;
};

const exports_ = identityScopedStore((onIdentityChange) => {
  const [commandOutputByWindow, setCommandOutputByWindow] = createSignal<
    Record<ChannelKey, CommandOutputEntry[]>
  >({});

  let seq = 0;

  onIdentityChange(() => {
    setCommandOutputByWindow({});
    seq = 0;
  });

  const appendCommandOutput = (
    windowKey: ChannelKey,
    lines: readonly CommandOutputLine[],
  ): void => {
    // One `at` for the whole invocation: the lines are one answer and must
    // never interleave with a message that lands between two of them.
    const at = Date.now();
    const entries = lines.map((line): CommandOutputEntry => {
      seq += 1;
      return { ...line, ts: seq, at };
    });
    setCommandOutputByWindow((prev) => ({
      ...prev,
      [windowKey]: [...(prev[windowKey] ?? []), ...entries],
    }));
  };

  return { commandOutputByWindow, appendCommandOutput };
});

export const commandOutputByWindow = exports_.commandOutputByWindow;
export const appendCommandOutput = exports_.appendCommandOutput;
