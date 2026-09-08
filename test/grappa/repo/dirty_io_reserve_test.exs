defmodule Grappa.Repo.DirtyIoReserveTest do
  @moduledoc """
  The boot-time pool-vs-dirty-IO reserve check.

  ## What it guards, and why a constant cannot

  Every SQLite call in this app runs inside a `ERL_NIF_DIRTY_JOB_IO_BOUND`
  NIF (exqlite), and a writer waiting on the file lock sleeps INSIDE that
  NIF — so it occupies a dirty-IO scheduler for the whole wait without
  doing any work. If `pool_size` reaches the dirty-IO scheduler count, a
  saturated pool can occupy every one of them and starve the rest of the
  node.

  The two numbers come from different worlds and neither can see the
  other: `pool_size` is ours (`config/runtime.exs`, `POOL_SIZE`), while the
  dirty-IO count is the BEAM's and is NOT derived from the hardware —
  ERTS's default does not follow the core count, and on the substrates
  that exec the release directly (the FreeBSD jail, the `.deb`/systemd
  host) nothing in this repo sets `+SDio` at all. A constant chosen today
  is therefore right only until somebody moves either side, and
  `GRAPPA_DIRTY_SCHEDULERS` lets an operator move the BEAM side with no
  floor applied. Hence a CHECK rather than a bigger comment.

  ## Both arms, on purpose

  A warning that cannot stay silent is not a check — it is a banner. The
  silent arm is what makes the firing arm evidence, so both are asserted
  here, and the scheduler count is a PARAMETER rather than a
  `system_info/1` read so neither arm depends on the host running the
  suite.
  """

  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  describe "check_dirty_io_reserve/2 fires when the reserve is gone" do
    test "warns when pool_size EQUALS the dirty-IO scheduler count" do
      log = capture_log(fn -> Grappa.Repo.check_dirty_io_reserve([pool_size: 10], 10) end)

      assert log =~ "dirty-IO"
      # Both numbers must be nameable from the line alone — an operator
      # reading it in journalctl has neither config nor a running IEx.
      assert log =~ "pool_size=10"
      assert log =~ "10 dirty-IO scheduler"
    end

    test "warns when pool_size EXCEEDS the dirty-IO scheduler count" do
      log = capture_log(fn -> Grappa.Repo.check_dirty_io_reserve([pool_size: 16], 10) end)

      assert log =~ "pool_size=16"
      assert log =~ "10 dirty-IO scheduler"
    end

    test "names the counter-advice, because the pool's own error contradicts it" do
      # DBConnection's pool-exhaustion message advises "Increasing the
      # pool_size", which is the opposite of what helps here. That advice
      # is the first thing an operator meets at 3 a.m., so the warning has
      # to answer it in place rather than leave the two to disagree.
      log = capture_log(fn -> Grappa.Repo.check_dirty_io_reserve([pool_size: 10], 10) end)

      assert log =~ "POOL_SIZE"
      assert log =~ "+SDio"
    end
  end

  describe "check_dirty_io_reserve/2 stays silent when a reserve exists" do
    test "says nothing when pool_size is below the dirty-IO scheduler count" do
      log = capture_log(fn -> Grappa.Repo.check_dirty_io_reserve([pool_size: 5], 10) end)

      refute log =~ "dirty-IO"
    end

    test "says nothing one short of the ceiling — the boundary is `>=`, not `>`" do
      log = capture_log(fn -> Grappa.Repo.check_dirty_io_reserve([pool_size: 9], 10) end)

      refute log =~ "dirty-IO"
    end

    test "says nothing when the config does not state a pool size at all" do
      # `init/2` is called with whatever config it is handed, and a caller that
      # builds one by hand — the WAL unit tests, a one-off tool — has no reason
      # to carry a pool size. Raising there would make this check DECIDE
      # whether the Repo may start, which is exactly what it must not do.
      log = capture_log(fn -> Grappa.Repo.check_dirty_io_reserve([database: ":memory:"], 10) end)

      refute log =~ "dirty-IO"
      assert Grappa.Repo.check_dirty_io_reserve([database: ":memory:"], 10) == :ok
    end

    test "the suite's own configuration is in the silent arm" do
      # config/test.exs runs pool_size: 1. If this ever fires, every other
      # test in the suite starts carrying an unrelated warning in its
      # captured log, which is how a check becomes noise nobody reads.
      pool_size = Keyword.fetch!(Grappa.Repo.config(), :pool_size)

      log = capture_log(fn -> Grappa.Repo.check_dirty_io_reserve([pool_size: pool_size], 10) end)

      refute log =~ "dirty-IO"
    end
  end

  describe "returns :ok either way" do
    test "the check reports, it never decides" do
      # Deliberately NOT a raise. The reserve being gone is the shipped
      # production posture today (pool_size 10 against an ERTS default of
      # 10 dirty-IO schedulers), so refusing to boot on it would refuse to
      # boot production. The operator must SEE it; the node must still run.
      assert capture_log(fn ->
               assert Grappa.Repo.check_dirty_io_reserve([pool_size: 10], 10) == :ok
             end) =~ "dirty-IO"

      assert Grappa.Repo.check_dirty_io_reserve([pool_size: 1], 10) == :ok
    end
  end
end
