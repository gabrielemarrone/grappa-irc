defmodule Grappa.VhostsClientSourceWriteTest do
  @moduledoc """
  2004 — `Vhosts.record_client_source/2` must not take SQLite's single
  writer lock for a sample it is not going to change.

  The capture fires on EVERY client connect and writes one key into the
  shared `user_settings.data` blob. Between two reconnects of the same
  client that key is normally IDENTICAL, and the put is unconditional, so
  the write transaction opens, takes `RESERVED`, discovers the changeset is
  empty and commits nothing. The lock is acquired before anyone knows there
  is anything to write.

  ## What is measured

  Ecto's per-query telemetry (`[:grappa, :repo, :query]`, the event
  `Grappa.DbLatency` already folds) runs its handlers SYNCHRONOUSLY in the
  process that issued the query — the same seam
  `Grappa.UserSettingsConcurrencyTest` uses to interleave two writers. The
  capture below is therefore exact, not a poll and not a sleep.

  ## What the Sandbox cannot buy, stated up front

  These tests assert on the write STATEMENTS the transaction carries, not on
  the `BEGIN IMMEDIATE` spelling of the frame around them, and that is a
  limit rather than a preference: under the Sandbox every transaction is
  nested and every mode is a `SAVEPOINT` — measured, and written down in
  `Grappa.UserSettingsConcurrencyTest`'s moduledoc. So a green here proves
  the writer lock is not REACHED; it does not re-prove how
  `Grappa.Repo.immediate_transaction/1` spells the acquisition.

  It also does not prove anything about the stall the sample was found in.
  Removing this holder removes THIS possession of the lock — why a holder
  sits in `RESERVED` for tens of seconds is a separate, still-unmeasured
  question inside the NIF.
  """
  use Grappa.DataCase, async: true

  import Grappa.AuthFixtures

  alias Grappa.Vhosts
  alias Grappa.Vhosts.SourceMapping

  # Statements that mutate, plus the transaction frame that would carry them.
  # Either one appearing is the defect: the frame takes `RESERVED` up front,
  # and the `INSERT ... ON CONFLICT DO NOTHING` that `get_or_init!/1` issues
  # is a write even on the connect where it changes nothing.
  @write_statements ~w(INSERT UPDATE DELETE BEGIN SAVEPOINT RELEASE)

  # Every Ecto query emitted IN THIS PROCESS while `fun` runs, in order.
  # Handlers run in the emitting process, so `Process.put/2` is the whole
  # accumulator — no agent, no message passing, nothing to race.
  defp capture_queries(fun) do
    key = {__MODULE__, make_ref()}
    test_pid = self()
    Process.put(key, [])

    :telemetry.attach(
      key,
      [:grappa, :repo, :query],
      # `:telemetry` handler args: event, measurements, metadata, config.
      fn _, _, meta, _ ->
        if self() == test_pid do
          Process.put(key, [meta[:query] | Process.get(key, [])])
        end
      end,
      nil
    )

    try do
      fun.()
    after
      :telemetry.detach(key)
    end

    key |> Process.get([]) |> Enum.reverse()
  end

  defp writes(queries) do
    Enum.filter(queries, fn q ->
      upcased = String.upcase(q || "")
      Enum.any?(@write_statements, &String.starts_with?(upcased, &1))
    end)
  end

  defp assert_no_writes(queries) do
    assert writes(queries) == [],
           "expected the repeat capture to issue no write statement, got:\n  " <>
             Enum.join(writes(queries), "\n  ")
  end

  describe "record_client_source/2 — the writer lock is not taken for an unchanged sample" do
    setup do
      user = user_fixture()
      subject = {:user, user.id}
      ip = {0x2001, 0xDB8, 1, 2, 3, 4, 5, 6}

      :ok = Vhosts.record_client_source(subject, ip)

      %{subject: subject, ip: ip}
    end

    test "a repeat capture of the same client prefix writes nothing at all", ctx do
      queries = capture_queries(fn -> assert :ok = Vhosts.record_client_source(ctx.subject, ctx.ip) end)

      assert_no_writes(queries)
    end

    test "a different address inside the SAME /64 is the same sample, so it writes nothing", ctx do
      # The interface id is dropped (RFC 8981), so a client that rotated its
      # temporary address has not moved: the stored key is already correct.
      roamed_interface_id = {0x2001, 0xDB8, 1, 2, 0xDEAD, 0xBEEF, 0xCAFE, 1}

      assert SourceMapping.client_key(roamed_interface_id) == SourceMapping.client_key(ctx.ip)

      queries =
        capture_queries(fn ->
          assert :ok = Vhosts.record_client_source(ctx.subject, roamed_interface_id)
        end)

      assert_no_writes(queries)
    end

    # The guard skips the WRITE, never the VALUE — mode 2 (#543) reads this
    # sample when no client is attached, and a subject without one is HELD
    # with `:no_client_source` instead of egressing from a shared pool.
    test "the skipped capture leaves the value readable, unchanged", ctx do
      assert :ok = Vhosts.record_client_source(ctx.subject, ctx.ip)

      assert Vhosts.last_client_prefix64(ctx.subject) == SourceMapping.client_key(ctx.ip)
    end

    test "a genuinely roamed prefix still writes, and the new value wins", ctx do
      roamed = {0x2001, 0xDB8, 99, 99, 1, 2, 3, 4}
      refute SourceMapping.client_key(roamed) == SourceMapping.client_key(ctx.ip)

      queries = capture_queries(fn -> assert :ok = Vhosts.record_client_source(ctx.subject, roamed) end)

      assert writes(queries) != [],
             "a changed sample must still be persisted, but no write statement was issued"

      assert Vhosts.last_client_prefix64(ctx.subject) == SourceMapping.client_key(roamed)
    end
  end

  describe "record_client_source/2 — the first capture is unaffected" do
    test "a subject with nothing recorded still writes, and the read-back is the production key" do
      user = user_fixture()
      subject = {:user, user.id}
      ip = {203, 0, 113, 7}

      assert Vhosts.last_client_prefix64(subject) == nil

      queries = capture_queries(fn -> assert :ok = Vhosts.record_client_source(subject, ip) end)

      assert writes(queries) != [],
             "the first capture for a subject must persist, but no write statement was issued"

      assert Vhosts.last_client_prefix64(subject) == SourceMapping.client_key(ip)
    end
  end
end
