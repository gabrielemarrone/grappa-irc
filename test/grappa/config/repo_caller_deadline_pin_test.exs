defmodule Grappa.Config.RepoCallerDeadlinePinTest do
  @moduledoc """
  `:timeout` — the DBConnection caller deadline — must be CHOSEN, in every
  env, not inherited from Ecto.

  ## Why a pin, when the value does not change

  Pinning it is byte-for-byte the behaviour that shipped before: Ecto's
  own default is `15_000` (`Ecto.Repo.Supervisor`'s `@defaults`, merged
  into the config BEFORE `Grappa.Repo.init/2` ever sees it). That is
  exactly the argument `config/runtime.exs` already makes for pinning
  `synchronous` and `foreign_keys` (REV-B/C3): a default that is "right by
  accident" is one dep major-version flip away from moving under prod with
  no diff, no log line, and no migration.

  It carries extra weight here because this number is half of a PAIR. The
  DB-side wait (`busy_timeout`, 30_000) was chosen; the caller-side
  deadline it should have been chosen against never was, and that is how
  the two came to sit at 30_000 against 15_000 — the caller giving up
  first, and DBConnection DESTROYING the connection when it does
  (`ConnectionPool.handle_info({:timeout, …})` → `Holder.handle_disconnect/2`),
  not merely failing the call. Whether those two numbers are the RIGHT
  pair is a separate, open question; this pin only ensures both are
  answers rather than one answer and one accident.

  ## Why the file and not the runtime config

  `Grappa.Repo.config()` cannot tell the two apart: an inherited `15_000`
  and a written `15_000` are the same keyword list by the time anything
  can read it. Only the source distinguishes "chosen" from "defaulted", so
  the source is what this reads — the same reason
  `Grappa.Config.EnvRegistryDriftTest` parses files rather than state.
  """

  use ExUnit.Case, async: true

  @configs ~w(config/runtime.exs config/dev.exs config/test.exs)

  defp read!(path), do: File.read!(Path.expand(path, File.cwd!()))

  # Lines whose TRIMMED form starts with the given key, so `busy_timeout:`
  # never answers for `timeout:`.
  defp assignments(source, key) do
    source
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&String.starts_with?(&1, key <> ":"))
  end

  describe "derivation self-check (guards against a vacuously-green pin)" do
    test "the scanner finds real content in every config it pins" do
      # Positive control: `busy_timeout` is present in all three today and
      # is not what this file is about. If the scanner broke, this fails
      # before the pin below can pass by reading nothing.
      for path <- @configs do
        assert length(assignments(read!(path), "busy_timeout")) == 1,
               "#{path}: scanner found no busy_timeout — the pin below would be vacuous"
      end
    end

    test "the matcher does not let busy_timeout answer for timeout" do
      # Negative control on the matcher itself, not on the repo.
      assert assignments("  busy_timeout: 30_000,", "timeout") == []
      assert assignments("  timeout: 15_000,", "timeout") == ["timeout: 15_000,"]
    end
  end

  describe "the caller deadline is written down, in every env" do
    test "each config sets :timeout exactly once, explicitly" do
      for path <- @configs do
        found = assignments(read!(path), "timeout")

        assert length(found) == 1,
               "#{path}: expected exactly one explicit `timeout:` in the Grappa.Repo " <>
                 "config, found #{inspect(found)}. An unset :timeout silently inherits " <>
                 "Ecto's default — see this module's docs."
      end
    end

    test "and sets it to the value that was already in force" do
      # The pin is about the number being CHOSEN, not about changing it.
      # Moving it is a behaviour change and belongs to the open question
      # about the whole ladder, not to this pin.
      for path <- @configs do
        [line] = assignments(read!(path), "timeout")

        assert String.starts_with?(line, "timeout: 15_000"),
               "#{path}: expected the pin to carry the value already in force, got #{line}"
      end
    end
  end
end
