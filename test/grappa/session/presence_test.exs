defmodule Grappa.Session.PresenceTest do
  @moduledoc """
  Tests for `Grappa.Session.Presence` (#247) — the pure MONITOR/WATCH
  command builder + the authoritative presence state map with
  baseline-vs-transition classification.
  """
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Grappa.Session.Presence

  describe "arm_commands/2" do
    test "MONITOR renders one comma-joined + line" do
      assert Presence.arm_commands({:monitor, 100}, ["Foo", "Bar", "baz"]) ==
               ["MONITOR + Foo,Bar,baz"]
    end

    test "WATCH renders one space-joined line with per-target + signs" do
      assert Presence.arm_commands({:watch, 128}, ["Foo", "Bar"]) == ["WATCH +Foo +Bar"]
    end

    test ":none and empty list render nothing" do
      assert Presence.arm_commands(:none, ["Foo"]) == []
      assert Presence.arm_commands({:monitor, 100}, []) == []
      assert Presence.arm_commands({:watch, :unlimited}, []) == []
    end

    property "every rendered line stays under the 512-byte IRC frame budget" do
      check all(
              nicks <-
                StreamData.list_of(
                  StreamData.string(:alphanumeric, min_length: 1, max_length: 30),
                  min_length: 1,
                  max_length: 200
                ),
              mechanism <- StreamData.member_of([{:monitor, 100}, {:watch, 128}])
            ) do
        for line <- Presence.arm_commands(mechanism, nicks) do
          assert byte_size(line) + 2 <= 512, "line over budget: #{byte_size(line)}"
        end
      end
    end

    property "chunked MONITOR lines cover every nick exactly once" do
      check all(
              nicks <-
                StreamData.uniq_list_of(
                  StreamData.string(:alphanumeric, min_length: 1, max_length: 30),
                  min_length: 1,
                  max_length: 200
                )
            ) do
        lines = Presence.arm_commands({:monitor, :unlimited}, nicks)
        rendered = Enum.flat_map(lines, fn "MONITOR + " <> targets -> String.split(targets, ",") end)

        assert rendered == nicks
      end
    end
  end

  describe "remove_commands/2" do
    test "MONITOR - / WATCH - shapes" do
      assert Presence.remove_commands({:monitor, 100}, ["Foo"]) == ["MONITOR - Foo"]
      assert Presence.remove_commands({:watch, 128}, ["Foo", "Bar"]) == ["WATCH -Foo -Bar"]
      assert Presence.remove_commands(:none, ["Foo"]) == []
    end
  end

  describe "seed/1 + apply_report/3" do
    test "seed folds keys (ASCII case) and starts :unknown (#525)" do
      assert Presence.seed(["Foo[1]", "Bar"]) == %{"foo[1]" => :unknown, "bar" => :unknown}
    end

    test "first report on an :unknown entry is :initial (baseline, no toast)" do
      seeded = Presence.seed(["Foo"])

      assert {:changed, :initial, reported} = Presence.apply_report(seeded, "Foo", :online)
      assert reported == %{"foo" => :online}
    end

    test "a genuine flip is :transition (toast-eligible)" do
      seeded = Presence.seed(["Foo"])
      {:changed, :initial, online} = Presence.apply_report(seeded, "Foo", :online)

      assert {:changed, :transition, flipped} = Presence.apply_report(online, "foo", :offline)
      assert flipped == %{"foo" => :offline}
    end

    test "duplicate reports dedupe to :unchanged" do
      seeded = Presence.seed(["Foo"])
      {:changed, :initial, online} = Presence.apply_report(seeded, "Foo", :online)

      assert Presence.apply_report(online, "FOO", :online) == :unchanged
    end

    test "reports fold ASCII case (FOO[1] report matches foo[1] entry) (#525)" do
      map = Presence.seed(["foo[1]"])
      assert {:changed, :initial, _} = Presence.apply_report(map, "FOO[1]", :online)
    end

    test "reports for untracked nicks are :unchanged — never invent entries" do
      map = Presence.seed(["Foo"])
      assert Presence.apply_report(map, "Stranger", :online) == :unchanged
    end
  end

  describe "track/2 + untrack/2" do
    test "track adds :unknown entries without clobbering known state" do
      seeded = Presence.seed(["Foo"])
      {:changed, :initial, online} = Presence.apply_report(seeded, "Foo", :online)

      tracked = Presence.track(online, ["FOO", "Bar"])
      assert tracked == %{"foo" => :online, "bar" => :unknown}
    end

    test "untrack drops fold-matched entries (ASCII case, #525)" do
      map = Presence.seed(["Foo[1]", "Bar"])
      # Case variant matches; a brace twin "foo{1}" would NOT.
      assert Presence.untrack(map, ["FOO[1]"]) == %{"bar" => :unknown}
    end
  end

  describe "reset/2 — a rename is not a transition (#378)" do
    test "a tracked nick goes back to :unknown, so the next report is :initial" do
      seeded = Presence.seed(["Alice"])
      {:changed, :initial, online} = Presence.apply_report(seeded, "Alice", :online)

      reset = Presence.reset(online, "Alice")
      assert reset == %{"alice" => :unknown}

      # And that is the whole point: the 601/605 that follows the NICK now
      # classifies :initial, which never pushes.
      assert {:changed, :initial, _} = Presence.apply_report(reset, "Alice", :offline)
    end

    test "the match folds — the display case of the renamed nick is irrelevant" do
      map = Presence.seed(["Alice"])
      assert Presence.reset(map, "ALICE") == %{"alice" => :unknown}
    end

    test "an untracked nick leaves the map untouched — never invents an entry" do
      map = Presence.seed(["Alice"])
      assert Presence.reset(map, "bob") == map
    end
  end

  # #1946 — the ISON fallback. The three properties worth pinning are the ones
  # a wrong implementation gets wrong SILENTLY: the reply budget, the
  # membership derivation, and the cadence.
  describe "poll_commands/1 (#1946)" do
    test "an empty watch list sends nothing at all" do
      assert Presence.poll_commands([]) == []
    end

    test "one line for a small list, in ISON syntax" do
      assert Presence.poll_commands(["alice", "bob"]) == ["ISON alice bob"]
    end

    # The budget is on the REPLY, not the request: IRCnet's m_ison fills its
    # buffer and `break`s, dropping the tail with no error. A chunk that would
    # overflow the reply when every nick is online turns those nicks offline.
    test "chunks so the REPLY fits even when every queried nick is online" do
      nicks = for i <- 1..60, do: String.duplicate("n", 14) <> Integer.to_string(rem(i, 10))
      lines = Presence.poll_commands(nicks)

      assert length(lines) > 1

      for line <- lines do
        names = String.replace_prefix(line, "ISON ", "")
        # worst case: the server echoes every name back, each with the trailing
        # space m_ison appends, under a prefix of up to ~86 bytes.
        # +86 is the worst-case `:<servername> 303 <mynick> :` reply prefix.
        assert byte_size(names) + 86 < 508
      end
    end

    test "every nick appears exactly once across the chunks" do
      nicks = for i <- 1..60, do: "nick#{i}"

      packed =
        nicks
        |> Presence.poll_commands()
        |> Enum.flat_map(&String.split(&1, " ", trim: true))
        |> Enum.reject(&(&1 == "ISON"))

      assert Enum.sort(packed) == Enum.sort(nicks)
    end
  end

  describe "fold_ison_names/1 (#1946)" do
    test "folds and drops the trailing space every ircd appends" do
      assert Presence.fold_ison_names("Alice Bob ") == ["alice", "bob"]
    end

    test "an empty or absent trailing is an empty set, not a crash" do
      assert Presence.fold_ison_names("") == []
      assert Presence.fold_ison_names(nil) == []
    end
  end

  describe "sweep_reports/2 (#1946)" do
    # ISON says only who is PRESENT, so absence from the union IS the offline
    # report. That is the whole mechanism, and the reason an incomplete sweep
    # must never be diffed.
    test "derives online by membership and offline by absence, over the whole map" do
      map = Presence.seed(["alice", "bob", "carol"])

      reports = Presence.sweep_reports(map, ["alice", "carol"])

      assert Enum.sort(reports) == [{"alice", :online}, {"bob", :offline}, {"carol", :online}]
    end

    test "reports nothing for an empty map" do
      assert Presence.sweep_reports(%{}, ["alice"]) == []
    end

    # The classifier is shared with MONITOR/WATCH, so a sweep gets the same
    # baseline rule for free: first answer is :initial, a later flip is a
    # :transition.
    test "feeding sweep_reports through apply_report gives baseline then transition" do
      map = Presence.seed(["alice"])

      assert [{"alice", :online}] = Presence.sweep_reports(map, ["alice"])
      assert {:changed, :initial, map} = Presence.apply_report(map, "alice", :online)

      assert [{"alice", :offline}] = Presence.sweep_reports(map, [])
      assert {:changed, :transition, _} = Presence.apply_report(map, "alice", :offline)
    end
  end

  describe "poll_interval_ms/1 (#1946)" do
    test "an empty list arms no timer" do
      assert Presence.poll_interval_ms(0) == nil
    end

    test "a small list polls at the floor" do
      assert Presence.poll_interval_ms(1) == 30_000
      assert Presence.poll_interval_ms(24) == 30_000
    end

    # The penalty is per LINE, so a list that needs more lines must sweep less
    # often or it eats its own flood budget.
    test "the interval grows with the number of chunks" do
      small = Presence.poll_interval_ms(24)
      large = Presence.poll_interval_ms(200)

      assert large > small
    end

    test "is monotonic in the list size" do
      sizes = [1, 24, 25, 60, 128, 400]
      intervals = Enum.map(sizes, &Presence.poll_interval_ms/1)

      assert intervals == Enum.sort(intervals)
    end
  end
end
