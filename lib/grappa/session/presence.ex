defmodule Grappa.Session.Presence do
  @moduledoc """
  Pure presence-watch mechanics for `/notify` (GH #247): upstream
  command building (MONITOR / WATCH) and the authoritative
  online/offline state map with baseline-vs-transition semantics.

  ## Why this exists

  The watch list is DB-owned (`Grappa.Notify`); MONITOR/WATCH
  registrations live on the upstream connection and die with it.
  `Grappa.Session.Server` re-arms on every (re)connect at end-of-MOTD
  (376/422 — the earliest point past the full 005 burst, which is when
  the mechanism pick from `Grappa.Session.ISupport.presence_mechanism/1`
  is known; 001 is too early). This module owns the two pure halves of
  that work:

    * **Command building** — the watch list rendered as upstream lines,
      chunked under the 512-byte IRC line budget (`MONITOR + a,b,c` /
      `WATCH +a +b`).
    * **State map** — `%{folded_nick => :online | :offline | :unknown}`.
      Seeded `:unknown` on arm; each MONITOR/WATCH report classifies as
      `:initial` (first report after arm — paint the dot, no toast) or
      `:transition` (a genuine online↔offline flip — toast-eligible),
      or dedupes to `:unchanged`. This is the issue's baseline-snapshot
      rule: adding a large list must not fire a notification storm.

  Keys are ASCII-folded via `Grappa.IRC.Identifier.canonical_target/1`
  — same fold as every other server-side nick compare (ASCII, #121/#525).

  ## Purity contract

  No side effects, no process state. `Grappa.Session.Server` holds the
  map on its state and sends the built commands via its `Client`.
  """

  alias Grappa.IRC.Identifier
  alias Grappa.Session.ISupport

  @typedoc "Live presence of one watched nick."
  @type presence :: :online | :offline | :unknown

  @typedoc "Authoritative per-session presence map, keyed by folded nick."
  @type state_map :: %{String.t() => presence()}

  @typedoc """
  Classification of one presence report against the current map:
  `:initial` — first report after arm (baseline snapshot; dot, no
  toast); `:transition` — genuine online↔offline flip (toast-eligible).
  """
  @type change_kind :: :initial | :transition

  # Conservative payload budget per line: 512 bytes minus CRLF minus
  # "MONITOR + " / "WATCH " command overhead, minus slack for a server
  # relaying with a prefix. Chunking at 400 keeps every mechanism's
  # frame comfortably inside RFC 1459's limit without per-command
  # arithmetic.
  @line_budget 400

  # #1946 — the ISON budget, and it is SMALLER than @line_budget on purpose.
  #
  # For MONITOR/WATCH the 512-byte cap binds on the line WE send. For ISON it
  # binds on the line the SERVER sends back, and IRCnet's `m_ison` fills its
  # reply buffer and then `break`s — dropping the tail with no error and no
  # marker (`ircd/s_user.c`: `if (len + i > sizeof(buf) - 4) break;`). The
  # reply carries only the ONLINE nicks, so a chunk sized against the REQUEST
  # can still overflow the reply, and every dropped nick would read as
  # offline. That fabricates "X went offline".
  #
  # So the chunk must fit even if EVERY queried nick comes back online:
  #   508 usable  −  worst-case `:<servername 63> 303 <mynick> :` prefix (~86)
  #   ≈ 420 bytes of names, minus slack.
  # At NICKLEN=15 that is ~24 nicks per line; short nicks pack more, because
  # the chunker measures bytes rather than counting.
  @ison_reply_budget 360

  # Cadence constants (#1946). The estimate is only used to SCALE the interval
  # — the actual chunking is by bytes, so a list of short nicks packs tighter
  # and simply polls more cheaply than this predicts.
  @nicks_per_chunk_estimate 24
  @min_poll_interval_ms 30_000
  @per_chunk_interval_ms 10_000

  # ---------------------------------------------------------------------------
  # Command building
  # ---------------------------------------------------------------------------

  @doc """
  The upstream lines that arm the whole watch list after registration.
  `[]` for `:none` (no mechanism advertised — v1 has no ISON fallback)
  or an empty list.

  MONITOR takes comma-separated targets (`MONITOR + a,b,c`); WATCH
  takes individually `+`-prefixed ones (`WATCH +a +b`). Both are
  chunked under the line budget. Limits are NOT enforced here — the
  server is the authority; `ERR_MONLISTFULL` (734) / `ERR_TOOMANYWATCH`
  (512) are surfaced as presence errors by the numeric handlers.
  """
  @spec arm_commands(ISupport.presence_mechanism(), [String.t()]) :: [String.t()]
  def arm_commands(_, []), do: []
  def arm_commands({:monitor, _}, nicks), do: monitor_commands("+", nicks)
  def arm_commands({:watch, _}, nicks), do: watch_commands("+", nicks)
  # #1946 — ISON arms NOTHING: it is a poll, and the sweep is driven by
  # `poll_commands/1` on a timer. An empty list rather than no clause at all,
  # deliberately: the live `/notify add` path calls this with whatever
  # mechanism the session resolved, and a FunctionClauseError there would take
  # down a working session over a nick the next sweep picks up anyway.
  def arm_commands(:ison, _), do: []

  def arm_commands(:none, _), do: []

  @doc """
  The upstream lines that add `nicks` to an already-armed session
  (live `/notify add` while connected). Same shapes as `arm_commands/2`.
  """
  @spec add_commands(ISupport.presence_mechanism(), [String.t()]) :: [String.t()]
  def add_commands(mechanism, nicks), do: arm_commands(mechanism, nicks)

  @doc """
  The upstream lines that remove `nicks` from an armed session
  (`MONITOR - a,b` / `WATCH -a -b`).
  """
  @spec remove_commands(ISupport.presence_mechanism(), [String.t()]) :: [String.t()]
  def remove_commands(_, []), do: []
  def remove_commands({:monitor, _}, nicks), do: monitor_commands("-", nicks)
  def remove_commands({:watch, _}, nicks), do: watch_commands("-", nicks)
  # #1946 — ISON arms NOTHING: it is a poll, and the sweep is driven by
  # `poll_commands/1` on a timer. An empty list rather than no clause at all,
  # deliberately: the live `/notify add` path calls this with whatever
  # mechanism the session resolved, and a FunctionClauseError there would take
  # down a working session over a nick the next sweep picks up anyway.
  def remove_commands(:ison, _), do: []

  def remove_commands(:none, _), do: []

  @doc """
  The ISON lines for one polling sweep over `nicks` (#1946).

  Deliberately NOT an `arm_commands/2` clause. MONITOR and WATCH are
  arm-and-receive: you register once and the server pushes. ISON is
  poll-and-diff — there is nothing to arm, and the caller must re-send this
  every cycle. Folding it into `arm_commands/2` would put two different verbs
  behind one name and let a caller "arm" ISON and then wait forever for a push
  that never comes.

  Chunked against `@ison_reply_budget` (the REPLY cap, see there), so a sweep
  over a large list is several lines. The COUNT matters to the caller: the
  server does not echo the request in `303`, so completeness can only be
  established by counting replies against `length(poll_commands(nicks))`.

  Empty list → no commands. A session watching nobody must send nothing.
  """
  @spec poll_commands([String.t()]) :: [String.t()]
  def poll_commands([]), do: []

  def poll_commands(nicks) when is_list(nicks) do
    nicks
    # the server appends one space after every name it returns
    |> chunk_by_budget(1, @ison_reply_budget)
    |> Enum.map(fn chunk -> "ISON " <> Enum.join(chunk, " ") end)
  end

  @doc """
  Derives one presence report per tracked nick from a completed ISON sweep
  (#1946).

  `online` is the folded union of every `303` reply in the sweep, as a list. Presence is
  derived by MEMBERSHIP: MONITOR/WATCH state what changed, ISON states only who
  is present, so absence from the union IS the offline report — and that is
  precisely why the caller must never call this on an incomplete sweep.

  Returns `[{folded_nick, :online | :offline}]` over the WHOLE map, for the
  caller to fold through `apply_report/3`. That keeps one classifier for all
  three mechanisms: baseline-vs-transition, dedupe, and the "never invent an
  entry" rule stay in `apply_report/3` rather than being re-derived here.
  """
  @spec sweep_reports(state_map(), [String.t()]) :: [{String.t(), :online | :offline}]
  def sweep_reports(map, online) when is_map(map) and is_list(online) do
    # The set is built HERE and never escapes. An earlier spelling carried a
    # `MapSet.t()` on `Session.Server`'s state type, which dialyzer rejects:
    # MapSet is opaque, so embedding one in a map type leaks the opacity across
    # every module that touches the state. A plain list crosses the boundary;
    # the set stays a local optimisation.
    set = MapSet.new(online)

    Enum.map(map, fn {key, _} ->
      {key, if(MapSet.member?(set, key), do: :online, else: :offline)}
    end)
  end

  @doc """
  Folds the names from one `303 RPL_ISON` trailing into a folded LIST (#1946).

  The trailing is space-separated and IRCnet appends a trailing space after
  every name, so `trim: true` is load-bearing rather than tidy.
  """
  @spec fold_ison_names(String.t() | nil) :: [String.t()]
  def fold_ison_names(nil), do: []

  def fold_ison_names(trailing) when is_binary(trailing) do
    trailing
    |> String.split(" ", trim: true)
    |> Enum.map(&Identifier.canonical_target/1)
  end

  @doc """
  Sweep interval in ms for a watch list of `count` nicks (#1946), or `nil` when
  there is nothing to watch.

  Budgeted against IRCnet's penalty system, measured in its source: a handler's
  return value IS its penalty in seconds (`cptr->since += ret`), `m_ison`
  returns 1, and the pre-dispatch base is `1 + len/100` — so a full ISON line
  costs roughly 2 penalty-seconds. One sweep is one line per chunk, hence the
  scaling: a 1-chunk list at 30 s spends ~7% of its budget, a 6-chunk list at
  30 s would spend ~40%, which is too hot to sustain.

  `nil` for an empty list is the whole point — most sessions watch nobody and
  must pay nothing, so the caller arms no timer at all.
  """
  @spec poll_interval_ms(non_neg_integer()) :: pos_integer() | nil
  def poll_interval_ms(0), do: nil

  def poll_interval_ms(count) when is_integer(count) and count > 0 do
    chunks = ceil(count / @nicks_per_chunk_estimate)
    max(@min_poll_interval_ms, chunks * @per_chunk_interval_ms)
  end

  # ---------------------------------------------------------------------------
  # State map
  # ---------------------------------------------------------------------------

  @doc """
  Seeds the presence map for `nicks` — every entry `:unknown` until the
  first upstream report. Folded keys.
  """
  @spec seed([String.t()]) :: state_map()
  def seed(nicks) when is_list(nicks) do
    Map.new(nicks, fn nick -> {Identifier.canonical_target(nick), :unknown} end)
  end

  @doc """
  Applies one upstream presence report to the map.

  Returns `{:changed, kind, map}` when the report changes the map —
  `kind` is `:initial` for the first report on an `:unknown` entry
  (baseline snapshot) and `:transition` for a genuine flip — or
  `:unchanged` for a duplicate report. Reports for nicks NOT in the
  map (a stale reply after `/notify del`, or an upstream echo we never
  asked for) are `:unchanged` — never invent entries the DB list
  doesn't carry.
  """
  @spec apply_report(state_map(), String.t(), :online | :offline) ::
          {:changed, change_kind(), state_map()} | :unchanged
  def apply_report(map, nick, presence)
      when is_map(map) and is_binary(nick) and presence in [:online, :offline] do
    key = Identifier.canonical_target(nick)

    case Map.fetch(map, key) do
      :error -> :unchanged
      {:ok, ^presence} -> :unchanged
      {:ok, :unknown} -> {:changed, :initial, Map.put(map, key, presence)}
      {:ok, _} -> {:changed, :transition, Map.put(map, key, presence)}
    end
  end

  @doc """
  Adds `nicks` (folded, `:unknown`) to an armed map — the live
  `/notify add` path. Existing entries keep their known state.
  """
  @spec track(state_map(), [String.t()]) :: state_map()
  def track(map, nicks) when is_map(map) and is_list(nicks) do
    Enum.reduce(nicks, map, fn nick, acc ->
      Map.put_new(acc, Identifier.canonical_target(nick), :unknown)
    end)
  end

  @doc """
  Puts a tracked `nick` back to `:unknown`, so its NEXT report classifies
  `:initial` instead of `:transition`. Untracked nicks are left alone —
  never invent an entry the DB list doesn't carry.

  The rename path (#378). A watched peer renaming emits `601`/`605` (or
  `731`) for the nick it vacated, which IS a genuine offline transition by
  every local test — but it is not the assertion a push would make ("alice
  went offline" about someone still here). #247 could live with that for a
  status dot; a lockscreen banner is an identity claim, so the entry is
  demoted to "no baseline yet" and the vacancy report re-establishes it
  silently. The watch ENTRY deliberately does not follow the rename.

  Bounded, and the bound is on the record: this buys the FALSE departure
  only. The vacancy report consumes the `:unknown`, re-baselining the entry
  to `:offline`, so a DIFFERENT human later taking the freed nick is a
  genuine transition and does push. Suppressing that needs a second
  "vacated" state beside this map — parallel state needing housekeeping,
  for a case #247 already ruled on: the watch list watches NICKS, not
  people. Pinned by `Grappa.Session.PresencePushTest`.
  """
  @spec reset(state_map(), String.t()) :: state_map()
  def reset(map, nick) when is_map(map) and is_binary(nick) do
    key = Identifier.canonical_target(nick)

    case Map.fetch(map, key) do
      {:ok, _} -> Map.put(map, key, :unknown)
      :error -> map
    end
  end

  @doc """
  Drops `nicks` (folded) from the map — the live `/notify del` /
  `clear` path.
  """
  @spec untrack(state_map(), [String.t()]) :: state_map()
  def untrack(map, nicks) when is_map(map) and is_list(nicks) do
    Map.drop(map, Enum.map(nicks, &Identifier.canonical_target/1))
  end

  # ---------------------------------------------------------------------------
  # Private — chunked command rendering
  # ---------------------------------------------------------------------------

  # MONITOR ± with comma-joined targets: "MONITOR + a,b,c".
  @spec monitor_commands(String.t(), [String.t()]) :: [String.t()]
  defp monitor_commands(sign, nicks) do
    nicks
    # comma joiner: 1 byte of overhead per packed nick
    |> chunk_by_budget(1, @line_budget)
    |> Enum.map(fn chunk -> "MONITOR #{sign} #{Enum.join(chunk, ",")}" end)
  end

  # WATCH ± with per-target sign: "WATCH +a +b" / "WATCH -a -b".
  @spec watch_commands(String.t(), [String.t()]) :: [String.t()]
  defp watch_commands(sign, nicks) do
    nicks
    # separator " " + sign prefix per target = 2 bytes of overhead
    |> chunk_by_budget(2, @line_budget)
    |> Enum.map(fn chunk ->
      "WATCH " <> Enum.map_join(chunk, " ", fn nick -> sign <> nick end)
    end)
  end

  # Greedy chunker: pack nicks until the payload would exceed the
  # budget. `overhead` is the per-nick joining cost (comma vs
  # space+sign). A single nick longer than the budget still ships alone
  # — the server rejects it, we don't silently drop it.
  @spec chunk_by_budget([String.t()], pos_integer(), pos_integer()) :: [[String.t()]]
  defp chunk_by_budget(nicks, overhead, budget) do
    {chunks, last, _} =
      Enum.reduce(nicks, {[], [], 0}, fn nick, {chunks, current, size} ->
        cost = byte_size(nick) + overhead

        cond do
          current == [] -> {chunks, [nick], cost}
          size + cost > budget -> {[Enum.reverse(current) | chunks], [nick], cost}
          true -> {chunks, [nick | current], size + cost}
        end
      end)

    case last do
      [] -> Enum.reverse(chunks)
      _ -> Enum.reverse([Enum.reverse(last) | chunks])
    end
  end
end
