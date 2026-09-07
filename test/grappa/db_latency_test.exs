defmodule Grappa.DbLatencyTest do
  @moduledoc """
  Singleton GenServer tests for `Grappa.DbLatency` (#357 — SQLite
  write-latency diagnostics + the broader repo query-latency profile).

  `async: false` because the process is registered as `__MODULE__` and
  the aggregate is shared across the suite (CP25 max_cases: 1 singleton
  invariant). No `Grappa.DataCase` / sandbox: the handler does zero Repo
  access — it only folds telemetry measurements into in-memory counters.

  The singleton boots with `attach_telemetry: false` under test
  (`config/test.exs`), so the aggregation describe attaches the handler
  explicitly (mirror of `Grappa.AdminEventsTest`) and drains state via
  the production `reset/0` between tests.
  """
  use ExUnit.Case, async: false

  alias Grappa.DbLatency
  alias Grappa.Repo.LockWatch

  @handler_id "grappa-db-latency"

  # 🔴 An INDEPENDENT copy of the production set, on purpose, and the
  # `attached_events/0` equality assertion below is what keeps it from
  # rotting. Deriving it from `DbLatency.attached_events/0` would make the
  # boot-wiring test tautological; leaving it underived and UNCHECKED is what
  # broke while #1901 was being built — a new emitter reached a new `fold/4`
  # clause, the suite stayed green, and the ring was silently empty because
  # this list never learned about the event.
  @events [
    [:grappa, :repo, :query],
    [:grappa, :scrollback, :persist, :stop],
    [:grappa, :session, :send_privmsg, :stop],
    [:grappa, :scrollback, :persist, :contention],
    [:grappa, :repo, :lock_stall, :detected],
    [:grappa, :repo, :lock_stall, :resolved]
  ]

  # Native-unit duration for a whole number of milliseconds, via the
  # production conversion (never hardcode the native tick rate).
  defp ms(n), do: System.convert_time_unit(n, :millisecond, :native)

  # 🔴 issue 1960 — the three verdicts share ONE event, so their payloads share
  # one shape and differ only where the verdict differs. Written out as
  # literals, INDEPENDENTLY of `Grappa.Repo.LockWatch`, on the same reasoning
  # as `@events` above: deriving them from the emitter would make every
  # assertion below a tautology, and the shape is exactly what this file is
  # for. Realistic values throughout — a stall this sink has actually seen in
  # prod, not zeroes that pass while validating nothing.
  defp detected_measurements, do: %{elapsed_ms: 2_400, waiter_count: 2, parked_count: 0}

  defp named_metadata do
    %{
      observed_at: "2026-09-01T10:06:57.328000Z",
      attribution: :named,
      subject: %{pid: "#PID<0.111.0>", elapsed_ms: 2_400, stacktrace: ["Foo.bar/1"]},
      holders: 1,
      waiters: [%{pid: "#PID<0.222.0>"}, %{pid: "#PID<0.333.0>"}],
      parked: [],
      registered_holders: 0,
      registered_waiters: 0
    }
  end

  defp none_measurements, do: %{elapsed_ms: 31_303, waiter_count: 3, parked_count: 0}

  defp none_metadata do
    %{
      observed_at: "2026-09-01T10:07:28.554000Z",
      attribution: :none,
      subject: %{pid: "#PID<0.222.0>", elapsed_ms: 31_303, stacktrace: ["Exqlite.Sqlite3NIF.step/2"]},
      holders: 0,
      waiters: [
        %{pid: "#PID<0.222.0>", elapsed_ms: 31_303, stacktrace: ["Exqlite.Sqlite3NIF.step/2"]},
        %{pid: "#PID<0.333.0>", elapsed_ms: 2_100},
        %{pid: "#PID<0.444.0>", elapsed_ms: 2_050}
      ],
      parked: [],
      registered_holders: 0,
      registered_waiters: 0
    }
  end

  defp cohort_measurements, do: %{elapsed_ms: 31_402, waiter_count: 0, parked_count: 2}

  defp cohort_metadata do
    parked = [
      %{
        pid: "#PID<0.222.0>",
        elapsed_ms: 31_402,
        current_function: "Exqlite.Sqlite3NIF.step/2",
        stacktrace: ["Grappa.Scrollback.persist_row/1"]
      },
      %{pid: "#PID<0.333.0>", elapsed_ms: 30_011, current_function: "Exqlite.Sqlite3NIF.execute/2"}
    ]

    %{
      observed_at: "2026-09-01T10:07:28.554000Z",
      attribution: :cohort,
      subject: hd(parked),
      holders: 0,
      waiters: [],
      parked: parked,
      registered_holders: 0,
      registered_waiters: 1
    }
  end

  defp resolved_metadata do
    %{
      observed_at: "2026-09-01T10:07:28.554000Z",
      holder_pid: "#PID<0.111.0>",
      announced: true,
      caller: %{
        pid: "#PID<0.111.0>",
        initial_call: "Grappa.Session.Server.init/1",
        stacktrace: ["Grappa.Repo.immediate_transaction/1"]
      }
    }
  end

  defp query_row(snapshot, source, op) do
    Enum.find(snapshot.queries, fn r -> r.source == source and r.op == op end)
  end

  setup do
    DbLatency.reset()
    :ok
  end

  describe "reset/0" do
    test "returns an empty aggregate before anything is recorded" do
      snapshot = DbLatency.snapshot()

      assert snapshot.queries == []
      assert snapshot.send_privmsg.n == 0
      assert snapshot.persist.n == 0
      assert snapshot.contention.n == 0
      assert snapshot.lock_stalls == []
    end
  end

  describe "aggregation via telemetry" do
    setup do
      :ok =
        :telemetry.attach_many(
          @handler_id,
          @events,
          &DbLatency.handle_telemetry/4,
          nil
        )

      on_exit(fn -> :telemetry.detach(@handler_id) end)
      :ok
    end

    test "[:grappa, :repo, :query] folds into a {source, op} bucket" do
      :telemetry.execute(
        [:grappa, :repo, :query],
        %{total_time: ms(10), queue_time: ms(2)},
        %{source: "messages", query: ~s|SELECT m0."id" FROM "messages" AS m0|}
      )

      # snapshot/0 is a call — drains the preceding cast.
      row = query_row(DbLatency.snapshot(), "messages", :select)

      assert row.n == 1
      assert_in_delta row.total_ms, 10.0, 0.5
      assert_in_delta row.queue_ms, 2.0, 0.5
      assert_in_delta row.mean_ms, 10.0, 0.5
    end

    test "SELECT count(...) is classified as :count, distinct from :select" do
      :telemetry.execute(
        [:grappa, :repo, :query],
        %{total_time: ms(30), queue_time: ms(0)},
        %{source: "messages", query: ~s|SELECT count(m0."id") FROM "messages" AS m0|}
      )

      :telemetry.execute(
        [:grappa, :repo, :query],
        %{total_time: ms(5), queue_time: ms(0)},
        %{source: "messages", query: ~s|SELECT m0."id" FROM "messages" AS m0|}
      )

      snapshot = DbLatency.snapshot()

      assert query_row(snapshot, "messages", :count).n == 1
      assert query_row(snapshot, "messages", :select).n == 1
      assert_in_delta query_row(snapshot, "messages", :count).total_ms, 30.0, 0.5
    end

    test "INSERT classified as :insert; repeated inserts accumulate n + mean" do
      for _ <- 1..3 do
        :telemetry.execute(
          [:grappa, :repo, :query],
          %{total_time: ms(6), queue_time: ms(1)},
          %{source: "messages", query: ~s|INSERT INTO "messages" ("body") VALUES (?)|}
        )
      end

      row = query_row(DbLatency.snapshot(), "messages", :insert)

      assert row.n == 3
      assert_in_delta row.total_ms, 18.0, 1.0
      assert_in_delta row.mean_ms, 6.0, 0.5
    end

    test "an outlier survives the fold into a bucket a mean would erase (#1901)" do
      # The end-to-end half of `Grappa.DbLatency.DistributionTest`: the unit
      # test buys the arithmetic, this buys that the arithmetic actually
      # reaches `snapshot/0` through the real telemetry fold. Until #1901 the
      # bucket kept `{n, total}` only, so this 31 s write left the table
      # reading 0.1 ms slower and nothing else.
      for _ <- 1..99 do
        :telemetry.execute(
          [:grappa, :repo, :query],
          %{total_time: ms(1), queue_time: ms(0)},
          %{source: "messages", query: ~s|INSERT INTO "messages" ("body") VALUES (?)|}
        )
      end

      :telemetry.execute(
        [:grappa, :repo, :query],
        %{total_time: ms(31_000), queue_time: ms(0)},
        %{source: "messages", query: ~s|INSERT INTO "messages" ("body") VALUES (?)|}
      )

      row = query_row(DbLatency.snapshot(), "messages", :insert)

      assert row.n == 100

      # The mean is the number that hides it: 100 samples, 99 of them 1 ms.
      # At production scale (324 679 samples) this moves by 0.1 ms.
      assert_in_delta row.mean_ms, 310.99, 5.0

      # 🔴 And the two that do not. A mutant that keeps the histogram but
      # takes `max` from the bucket BOUND reports 30 000 ms for a 31 000 ms
      # write; one that drops the histogram entirely has no max at all.
      assert_in_delta row.max_ms, 31_000.0, 50.0

      # The tail says it was one accident rather than a shifted population —
      # the second half of the reading, and the reason a bare `max_ms` was
      # not enough on its own.
      assert row.p95_ms <= 1.0
    end

    test "the span families carry the same shape, so neither axis is half-migrated" do
      # `persist` and `send_privmsg` fold the same way and hide an outlier
      # the same way, so they get the same accumulator. A mutant that gives
      # the histogram to `queries` only leaves the two write-path spans —
      # mechanisms 1 and 3 of #357 — reading a mean and nothing else.
      :telemetry.execute([:grappa, :scrollback, :persist, :stop], %{duration: ms(1)}, %{outcome: :ok})
      :telemetry.execute([:grappa, :scrollback, :persist, :stop], %{duration: ms(9_000)}, %{outcome: :ok})
      :telemetry.execute([:grappa, :session, :send_privmsg, :stop], %{duration: ms(4_000)}, %{outcome: :ok})

      snapshot = DbLatency.snapshot()

      assert_in_delta snapshot.persist.max_ms, 9_000.0, 20.0
      assert snapshot.persist.p99_ms >= 9_000.0
      assert_in_delta snapshot.send_privmsg.max_ms, 4_000.0, 20.0

      # The outcome tally is untouched by the change of accumulator.
      assert snapshot.persist.outcomes[:ok] == 2
    end

    test "queries are returned sorted by total_ms descending" do
      :telemetry.execute(
        [:grappa, :repo, :query],
        %{total_time: ms(5)},
        %{source: "read_cursors", query: "SELECT 1"}
      )

      :telemetry.execute(
        [:grappa, :repo, :query],
        %{total_time: ms(50)},
        %{source: "messages", query: "SELECT 1"}
      )

      assert [%{source: "messages"} | _] = DbLatency.snapshot().queries
    end

    test "[:grappa, :scrollback, :persist, :stop] folds into the persist row with outcome counts" do
      :telemetry.execute(
        [:grappa, :scrollback, :persist, :stop],
        %{duration: ms(8)},
        %{channel: "#test", kind: :privmsg, outcome: :ok}
      )

      :telemetry.execute(
        [:grappa, :scrollback, :persist, :stop],
        %{duration: ms(4)},
        %{channel: "#test", kind: :privmsg, outcome: :unavailable}
      )

      persist = DbLatency.snapshot().persist

      assert persist.n == 2
      assert_in_delta persist.total_ms, 12.0, 1.0
      assert persist.outcomes[:ok] == 1
      assert persist.outcomes[:unavailable] == 1
    end

    test "[:grappa, :session, :send_privmsg, :stop] folds into the send row" do
      :telemetry.execute(
        [:grappa, :session, :send_privmsg, :stop],
        %{duration: ms(20)},
        %{network_id: 1, target: "#test", outcome: :ok}
      )

      send_row = DbLatency.snapshot().send_privmsg

      assert send_row.n == 1
      assert_in_delta send_row.total_ms, 20.0, 1.0
      assert send_row.outcomes[:ok] == 1
    end

    test "[:grappa, :scrollback, :persist, :contention] folds into the contention row by fault + dropped" do
      :telemetry.execute(
        [:grappa, :scrollback, :persist, :contention],
        %{attempt: 1},
        %{fault: :busy_locked, dropped: false}
      )

      :telemetry.execute(
        [:grappa, :scrollback, :persist, :contention],
        %{attempt: 2},
        %{fault: :queue_timeout, dropped: true}
      )

      contention = DbLatency.snapshot().contention

      assert contention.n == 2
      assert contention.busy_locked == 1
      assert contention.queue_timeout == 1
      assert contention.dropped == 1
    end

    test "[:grappa, :repo, :lock_stall, :*] folds both brackets of an episode, newest first" do
      :telemetry.execute([:grappa, :repo, :lock_stall, :detected], detected_measurements(), named_metadata())
      :telemetry.execute([:grappa, :repo, :lock_stall, :resolved], %{held_ms: 30_120}, resolved_metadata())

      assert [resolved, detected] = DbLatency.snapshot().lock_stalls

      # Newest first: an operator reading a live incident wants the last
      # thing that happened at the top, not to scroll a boot-long history.
      assert resolved.phase == :resolved
      assert resolved.elapsed_ms == 30_120
      assert resolved.subject == nil

      # issue 1960 — `attribution` is nil on the closing bracket, and that is
      # not an omission: at release the row IS the holder's own, so the
      # question the field answers does not arise. A mutant that defaults it
      # to `:named` would let a reader believe the watchdog attributed an
      # episode it may never have announced at all.
      assert resolved.attribution == nil

      # #1888 — `subject` stays nil (a `sample()` means "sampled while it
      # stalled", and by release there is no pause site left to sample) while
      # `caller` carries the write path that held the lock. Two different
      # facts, two different keys: folding them would let a release-time stack
      # be read as the frame the holder paused in.
      assert resolved.caller.initial_call == "Grappa.Session.Server.init/1"
      assert resolved.announced == true

      # `waiter_count` is nil, not 0: nothing in a closing bracket counted a
      # queue, and a 0 would assert an empty one was measured.
      assert resolved.waiter_count == nil

      assert detected.phase == :detected
      assert detected.attribution == :named
      assert detected.waiter_count == 2
      assert detected.subject.stacktrace == ["Foo.bar/1"]
      assert length(detected.waiters) == 2

      # The instant, on both edges: a ring row that cannot be aligned with
      # `erlang.log` cannot be matched to the freeze it belongs to.
      assert resolved.observed_at == "2026-09-01T10:07:28.554000Z"
      assert detected.observed_at == "2026-09-01T10:06:57.328000Z"
    end

    # 🔴 issue 1960 replaced the `:unattributed` PHASE with an `attribution`
    # field, and this test is the same claim it always made: a queue past the
    # threshold that could name nobody must not acquire a holder on its way
    # into the ring. What changed is where the honesty lives — the row no
    # longer says "nobody was named" by leaving `holder_pid` empty, it says it
    # in a field, which is stronger because an empty column and an unset
    # column are indistinguishable to a reader.
    test "[:grappa, :repo, :lock_stall, :detected] with attribution :none names nobody as the holder" do
      :telemetry.execute([:grappa, :repo, :lock_stall, :detected], none_measurements(), none_metadata())

      assert [row] = DbLatency.snapshot().lock_stalls

      assert row.phase == :detected
      assert row.attribution == :none
      assert row.waiter_count == 3

      # 🔴 The honesty pair. CLAUDE.md's admin rule — an explicit null is the
      # signal, never papered over with a computed field — lands here: a
      # synthesised holder would name somebody nothing measured, and
      # `holders: 0` is the number that says the SEAM saw no holder at all
      # (as opposed to seeing one that had not crossed the threshold).
      assert row.holders == 0
      assert row.subject.pid == "#PID<0.222.0>"

      # `elapsed_ms` is the subject's, and on this verdict it is a WAIT. The
      # column carries no hold claim of its own — that is the #1687 ruling,
      # and `attribution` above is what makes reading it unambiguous.
      assert row.elapsed_ms == 31_303

      # #1888 — the two fields only a closing bracket can answer. Nothing here
      # released a hold, so there is no write path to name and no announcement
      # to report; both stay explicitly absent.
      assert row.caller == nil
      assert row.announced == nil

      # The waiters ARE the payload: they are the only thing this episode can
      # honestly show, and the stack is what separates "blocked on the lock"
      # from "queued for a connection".
      assert length(row.waiters) == 3
      assert hd(row.waiters).stacktrace == ["Exqlite.Sqlite3NIF.step/2"]
    end

    test "[:grappa, :repo, :lock_stall, :detected] with attribution :cohort folds the roster" do
      :telemetry.execute([:grappa, :repo, :lock_stall, :detected], cohort_measurements(), cohort_metadata())

      assert [row] = DbLatency.snapshot().lock_stalls

      assert row.phase == :detected
      assert row.attribution == :cohort
      assert row.observed_at == "2026-09-01T10:07:28.554000Z"

      # 🔴 `:cohort` is a STRONGER refusal than `:none`, and a mutant that
      # promotes the longest-parked process to a holder — the plausible guess,
      # and the one #1901's acceptance criterion invites — dies on this
      # equality. A holder is certainly among `parked`; the instrument simply
      # cannot say which, because exqlite's busy handler sleeps inside the
      # same dirty-IO NIF the lock holder is executing in. Naming the SUBJECT
      # is not naming the holder, and `attribution` is what keeps the two
      # apart in the row as the prose keeps them apart in the line.
      assert row.subject.pid == "#PID<0.222.0>"
      assert row.holders == 0
      assert row.caller == nil
      assert row.announced == nil

      # The cohort counts no QUEUE. `parked_count` is a different measurement
      # and rides the measurements map, exactly as #1687 refused to reuse
      # `held_ms` for a longest WAIT. A mutant that copies `parked_count` into
      # the queue column reports two blocked writers where nobody measured one.
      assert row.waiter_count == 0
      assert row.waiters == []

      # The roster IS the payload, and the counts are what tell an operator
      # whether to widen coverage or to read the seam numbers on the same line.
      assert length(row.parked) == 2
      assert hd(row.parked).stacktrace == ["Grappa.Scrollback.persist_row/1"]
      assert row.registered_holders == 0
      assert row.registered_waiters == 1
    end

    # 🔴 THE VOID CONTROL (issue 1960, and it is why this test is not a
    # duplicate of the drift test below).
    #
    # `fold/4` has NO catch-all, so the two failure modes are asymmetric and
    # only one of them is loud. An event attached with no clause CRASHES the
    # singleton — noisy, findable. A clause left attached with no EMITTER
    # folds nothing, in silence, and the ring quietly stops filling: exactly
    # what happened while #1901 was being built. Pruning two emitters here is
    # the move that can reproduce it, so both directions get a control.
    test "no lock-stall event is attached without an emitter, and none is emitted without a fold" do
      # NEGATIVE — derived from the EMITTER, so an event this sink attaches
      # after LockWatch stops emitting it is red rather than silent.
      attached = Enum.filter(DbLatency.attached_events(), &match?([:grappa, :repo, :lock_stall, _], &1))

      assert Enum.sort(attached) == Enum.sort(LockWatch.emitted_events())

      # POSITIVE — every one of them, driven with a realistic payload, lands a
      # ring row. That is what a set equality alone cannot show: the event can
      # be attached, present in `@events`, and still fold nothing.
      for {event, measurements, metadata} <- [
            {[:grappa, :repo, :lock_stall, :detected], detected_measurements(), named_metadata()},
            {[:grappa, :repo, :lock_stall, :resolved], %{held_ms: 30_120}, resolved_metadata()}
          ] do
        :ok = DbLatency.reset()
        :telemetry.execute(event, measurements, metadata)

        # `match?/2` and not `assert [_] = …`: a match assertion discards the
        # custom message, and the whole value of this control is that the
        # failure NAMES the event that folded nothing.
        assert match?([_], DbLatency.snapshot().lock_stalls),
               "#{inspect(event)} is attached but folded no ring row"
      end
    end

    test "the lock-stall ring is bounded, keeping the newest episodes" do
      for n <- 1..25 do
        :telemetry.execute(
          [:grappa, :repo, :lock_stall, :resolved],
          %{held_ms: n},
          %{
            observed_at: "2026-09-01T10:07:#{String.pad_leading("#{n}", 2, "0")}.000000Z",
            holder_pid: "#PID<0.#{n}.0>",
            announced: false,
            caller: %{pid: "#PID<0.#{n}.0>", initial_call: "unknown", stacktrace: []}
          }
        )
      end

      stalls = DbLatency.snapshot().lock_stalls

      # These rows carry sampled stacktraces; unbounded, they would grow the
      # singleton's heap for as long as the node lives.
      assert length(stalls) == 20
      assert hd(stalls).elapsed_ms == 25
      assert List.last(stalls).elapsed_ms == 6
    end

    test "reset/0 zeroes accumulated state" do
      :telemetry.execute(
        [:grappa, :repo, :query],
        %{total_time: ms(10)},
        %{source: "messages", query: "SELECT 1"}
      )

      # Drain, then reset.
      _ = DbLatency.snapshot()
      :ok = DbLatency.reset()

      assert DbLatency.snapshot().queries == []
    end
  end

  describe "init/1 attach flag (boot wiring)" do
    setup do
      :telemetry.detach(@handler_id)
      on_exit(fn -> :telemetry.detach(@handler_id) end)
      :ok
    end

    test "the production event set and this file's expectation of it have not drifted" do
      # The two failures this catches are asymmetric and BOTH are quiet.
      # A production event with no clause in this file's `@events` never
      # reaches an assertion, so a fold bug ships green; an entry here with no
      # production event makes every test in the aggregation describe fold
      # nothing, which reads as "the emitter is broken" and sends the reader
      # to the wrong module. Naming the difference costs one assertion.
      assert Enum.sort(DbLatency.attached_events()) == Enum.sort(@events)
    end

    test "attach_telemetry: true attaches the handler to every measured event" do
      assert {:ok, _} = DbLatency.init(attach_telemetry: true)

      for event <- @events do
        assert Enum.any?(:telemetry.list_handlers(event), &(&1.id == @handler_id)),
               "expected handler attached for #{inspect(event)}"
      end
    end

    test "attach_telemetry: false attaches nothing" do
      assert {:ok, _} = DbLatency.init(attach_telemetry: false)

      refute Enum.any?(
               :telemetry.list_handlers([:grappa, :repo, :query]),
               &(&1.id == @handler_id)
             )
    end
  end
end
