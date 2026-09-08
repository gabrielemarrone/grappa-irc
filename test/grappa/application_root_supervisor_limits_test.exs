defmodule Grappa.ApplicationRootSupervisorLimitsTest do
  # The root supervisor's restart budget, pinned from BOTH sides.
  #
  # `Grappa.Supervisor` used to start with no `max_restarts`/`max_seconds`,
  # i.e. OTP's default 3-in-5s — a default, never a decision. The sibling
  # `SessionSupervisor` two lines above carries an argued 10_000/60, so the
  # absence here read as "considered and left alone" when it was
  # "never considered".
  #
  # Measured on the m42 jail, 2026-09-08, two node deaths in half an hour:
  #
  #   20:36:31.150–.472   4 top-level children in   322 ms  (three Reapers + AdminEvents)
  #   21:06:38.979–40.053 5 top-level children in 1_070 ms  (of which Bootstrap x3)
  #
  # Both bursts are ONE correlated degradation — the SQLite pool saturating —
  # arriving at several Repo-reading singletons at once. Three of them inside
  # 5s is enough to take the node down, and that is what happened.
  #
  # The two tests below are a PAIR and neither is redundant:
  #
  #   1. the budget must ABSORB a correlated burst — else the fix cures nothing;
  #   2. the budget must still GIVE UP — else the fix trades a node that dies
  #      loudly for a node that restart-loops forever while looking alive,
  #      which is strictly worse for an operator (rc.d sees a live service).
  #
  # Test 2 is the one that stops a future "just raise it to 10_000" from
  # sailing through green: copying the SessionSupervisor's budget here would
  # make the root effectively immortal (~167 restarts/s sustained).
  use ExUnit.Case, async: true

  # The measured worst correlated burst (5 children in 1.07s). The budget has
  # to sit ABOVE this or it does not cure the incident it was written for.
  @measured_correlated_burst 5

  # A restart takes microseconds here, so a burst is delivered well inside any
  # sane `max_seconds`; the deadline only guards against a wedged supervisor.
  @await_ms 2_000

  describe "the root supervisor's restart budget" do
    test "declares an explicit budget rather than inheriting OTP's 3-in-5s default" do
      opts = Grappa.Application.root_supervisor_opts()

      assert Keyword.fetch!(opts, :strategy) == :one_for_one

      assert is_integer(Keyword.get(opts, :max_restarts)),
             "the root supervisor must state its restart budget: an absent max_restarts " <>
               "silently means 3-in-5s, which a correlated degradation clears trivially"

      assert is_integer(Keyword.get(opts, :max_seconds))
    end

    test "absorbs the measured correlated burst of #{@measured_correlated_burst} child deaths" do
      Process.flag(:trap_exit, true)
      sup = start_probe_supervisor(@measured_correlated_burst)

      for id <- 1..@measured_correlated_burst do
        kill_and_await_restart(sup, id)
      end

      assert Process.alive?(sup),
             "the root supervisor gave up after #{@measured_correlated_burst} correlated " <>
               "child deaths — this is the 2026-09-08 node death, unfixed"

      assert length(Supervisor.which_children(sup)) == @measured_correlated_burst
    end

    test "still gives up on a child that exceeds the budget, so a wedged node dies loudly" do
      Process.flag(:trap_exit, true)
      budget = Keyword.fetch!(Grappa.Application.root_supervisor_opts(), :max_restarts)

      sup = start_probe_supervisor(1)
      ref = Process.monitor(sup)

      # One child, killed until the supervisor gives up: the shape of a
      # genuine crash-loop (bad config, unbindable port, a boot read that
      # cannot succeed), not of a transient degradation. Each kill WAITS for
      # the restart, so the kills and the restarts are one-to-one — killing
      # a pid the supervisor has not replaced yet costs no budget at all.
      kills = kill_until_supervisor_gives_up(sup, 1, budget + 1)

      assert_receive {:DOWN, ^ref, :process, ^sup, _reason},
                     @await_ms,
                     "the root supervisor absorbed #{kills} restarts of a single child: " <>
                       "the budget is no longer a protection, it is an infinite loop"
    end
  end

  # --- probe supervisor -------------------------------------------------
  #
  # Runs the PRODUCTION opts (only the registered name is swapped, so the
  # probe cannot collide with the real tree) over trivial children. What is
  # under test is the budget, not the children.

  defp start_probe_supervisor(child_count) do
    probe_name = :"#{__MODULE__}.Probe.#{System.unique_integer([:positive])}"
    opts = Keyword.replace!(Grappa.Application.root_supervisor_opts(), :name, probe_name)

    children =
      for id <- 1..child_count do
        Supervisor.child_spec({Agent, fn -> id end}, id: id)
      end

    # Linked to the test process, so it dies with the test — no on_exit stop,
    # which would race that same teardown and exit `:shutdown`.
    {:ok, sup} = Supervisor.start_link(children, opts)
    sup
  end

  defp kill_and_await_restart(sup, id) do
    case kill_and_settle(sup, id) do
      {:restarted, pid} -> pid
      :supervisor_gave_up -> flunk("supervisor died while awaiting the restart of child #{id}")
      :timeout -> flunk("child #{id} was not restarted within #{@await_ms}ms")
    end
  end

  defp kill_until_supervisor_gives_up(sup, id, max_kills) do
    Enum.reduce_while(1..max_kills, 0, fn n, _ ->
      case kill_and_settle(sup, id) do
        {:restarted, _} -> {:cont, n}
        :supervisor_gave_up -> {:halt, n}
        :timeout -> {:halt, n}
      end
    end)
  end

  # Kills the child and returns only once the supervisor has SETTLED: either
  # it replaced the child (one restart spent) or it exhausted its budget.
  defp kill_and_settle(sup, id) do
    case child_pid(sup, id) do
      old when is_pid(old) ->
        Process.exit(old, :kill)
        await_settle(sup, id, old, System.monotonic_time(:millisecond) + @await_ms)

      _ ->
        :supervisor_gave_up
    end
  end

  defp await_settle(sup, id, old, deadline) do
    cond do
      not Process.alive?(sup) ->
        :supervisor_gave_up

      System.monotonic_time(:millisecond) > deadline ->
        :timeout

      true ->
        case child_pid(sup, id) do
          pid when is_pid(pid) and pid != old -> {:restarted, pid}
          _ -> await_settle(sup, id, old, deadline)
        end
    end
  end

  defp child_pid(sup, id) do
    sup
    |> Supervisor.which_children()
    |> Enum.find_value(fn
      {^id, pid, _, _} -> pid
      _ -> nil
    end)
  rescue
    # `which_children` on a supervisor that just exited.
    _ -> nil
  catch
    :exit, _ -> nil
  end
end
