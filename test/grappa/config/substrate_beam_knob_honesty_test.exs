defmodule Grappa.Config.SubstrateBeamKnobHonestyTest do
  @moduledoc """
  An operator env-example may only advertise knobs that its OWN substrate
  reads.

  ## The drift this pins

  `GRAPPA_MAX_USERS` and `GRAPPA_DIRTY_SCHEDULERS` are read by exactly two
  files — `bin/start.sh` (dev compose, `mix phx.server`) and
  `infra/docker/release-entrypoint.sh` (the published release image) —
  which turn them into `+Q`/`+P`/`+SDcpu`/`+SDio`. Both are CONTAINER
  entrypoints.

  The FreeBSD jail (`infra/freebsd/rc.d/grappa`) and the packaged systemd
  host (`infra/packaging/grappa.service`) exec the release directly;
  `infra/release/grappa.sh` and `infra/packaging/grappa-wrapper.sh` set no
  BEAM flags at all. So on those two substrates the variables are read by
  nothing — and both example files nevertheless listed them under a
  "BEAM resource caps" heading, in the one file a self-hoster is told to
  edit.

  ## What is NOT wrong here, measured before asserting

  The absence of the caps themselves on those substrates is DELIBERATE and
  documented: `docs/OPERATIONS.md` § `release-entrypoint.sh` explains that
  a baked `rel/vm.args` "would ship inside the release and so change the
  jail, `.deb` and `.rpm` consumers too, and these caps are THIS image's
  concern" — they cure a Docker-specific inherited `NOFILE`. This pin is
  therefore about the ADVERTISEMENT, not about the missing flags. Wiring
  the knobs into those substrates would contradict a standing decision;
  listing them there contradicts reality. Only the second is a defect.

  ## Assignment form, not mention

  The examples may — and should — NAME the variables in prose to explain
  why they do nothing locally. What they must not carry is an assignment
  line, commented or not, because a commented assignment exists to be
  uncommented.

  ## And the other half: the lever that DOES work must be there

  Removing a dead knob without offering the live one would leave the
  substrate with no documented way to size its BEAM at all, which is a
  different lie by omission. `ERL_ZFLAGS` is that lever on both release
  substrates — the jail's rc.d sources this file and exports every
  `^[A-Z_]` name in it, systemd loads it via `EnvironmentFile`, and
  erlexec appends `ERL_ZFLAGS` to the release's boot flags. So the pin has
  two sides: no assignment for the knob that does nothing, and a documented
  `ERL_ZFLAGS` for the one that does.
  """

  use ExUnit.Case, async: true

  @container_only ~w(GRAPPA_MAX_USERS GRAPPA_DIRTY_SCHEDULERS)

  # Substrates whose start path is the release itself, no entrypoint.
  @release_examples ~w(infra/freebsd/grappa.env.example infra/linux/grappa.env.example)

  # The Docker operator file, where the same names are legitimate.
  @docker_example ".env.example"

  defp read!(path), do: File.read!(Path.expand(path, File.cwd!()))

  # Every line, stripped of indentation and of a leading comment marker, so
  # a commented knob reads the same as a live one — the whole point being
  # that a commented assignment exists to be uncommented.
  defp normalized_lines(source) do
    source
    |> String.split("\n")
    |> Enum.map(fn line -> line |> String.trim() |> String.trim_leading("#") |> String.trim() end)
  end

  # `FOO=`, with or without a leading comment marker and whitespace.
  defp assignment_lines(source, var) do
    source
    |> normalized_lines()
    |> Enum.filter(&String.starts_with?(&1, var <> "="))
  end

  describe "derivation self-check (guards against a vacuously-green pin)" do
    test "the matcher finds the assignments where they legitimately live" do
      # Positive control: if this stops finding them in the Docker example,
      # the matcher is broken and the refutations below prove nothing.
      for var <- @container_only do
        assert assignment_lines(read!(@docker_example), var) != [],
               "#{@docker_example}: expected #{var} to be documented here — " <>
                 "matcher may be broken, which would make this whole file vacuous"
      end
    end

    test "the matcher distinguishes an assignment from a mention" do
      assert assignment_lines("# GRAPPA_MAX_USERS=100", "GRAPPA_MAX_USERS") == [
               "GRAPPA_MAX_USERS=100"
             ]

      assert assignment_lines("GRAPPA_MAX_USERS=100", "GRAPPA_MAX_USERS") == [
               "GRAPPA_MAX_USERS=100"
             ]

      assert assignment_lines("# GRAPPA_MAX_USERS is read only by bin/start.sh", "GRAPPA_MAX_USERS") ==
               []
    end

    test "the substrates under test really do exec the release directly" do
      # The premise of the whole file. If someone later adds an entrypoint
      # that reads these, this test fails and the pin below should go.
      refute read!("infra/packaging/grappa.service") =~ "ERL_ZFLAGS"
      refute read!("infra/release/grappa.sh") =~ "ERL_ZFLAGS"
      refute read!("infra/packaging/grappa-wrapper.sh") =~ "ERL_ZFLAGS"
      refute read!("infra/freebsd/rc.d/grappa") =~ "ERL_ZFLAGS"

      # ...and that the two that DO read them still do.
      assert read!("bin/start.sh") =~ "+SDio"
      assert read!("infra/docker/release-entrypoint.sh") =~ "+SDio"
    end
  end

  describe "release substrates do not advertise container-only knobs" do
    test "no assignment line for a variable the substrate cannot read" do
      for path <- @release_examples, var <- @container_only do
        assert assignment_lines(read!(path), var) == [],
               "#{path} offers `#{var}=` as an operator knob, but nothing on this " <>
                 "substrate reads it: the release is exec'd directly, with no entrypoint. " <>
                 "Explain it in prose instead of offering an assignment."
      end
    end
  end

  describe "release substrates document the lever that DOES work" do
    test "each offers ERL_ZFLAGS, with +SDio named" do
      for path <- @release_examples do
        source = read!(path)

        assert assignment_lines(source, "ERL_ZFLAGS") != [],
               "#{path} removes the container-only knobs but offers no working " <>
                 "alternative — the substrate is left with no documented way to size " <>
                 "its BEAM at all."

        assert source =~ "+SDio",
               "#{path}: ERL_ZFLAGS is offered without naming the flag that matters " <>
                 "for a SQLite pool — see this module's docs."
      end
    end

    test "and say what raising it does NOT buy" do
      # The measured trap: more dirty-IO threads buy reserve while a
      # writer is parked, never write throughput — SQLite has one writer.
      # An operator who reads this as a throughput knob will raise it and
      # conclude grappa is slow.
      for path <- @release_examples do
        assert read!(path) =~ "one writer",
               "#{path}: +SDio is documented without the single-writer caveat"
      end
    end
  end

  describe "the pool default agrees across every surface that states it" do
    test "no surface still advertises the pre-reserve default" do
      # The drift the 2026-07-20 architecture review named: one env var
      # declared in up to seven places with nothing checking agreement.
      # POOL_SIZE moved, so every surface that names a value must move
      # with it or the operator reads a number the app does not use.
      surfaces = [
        ".env.example",
        "compose.yaml",
        "infra/freebsd/grappa.env.example",
        "infra/linux/grappa.env.example",
        "infra/packaging/grappa.env.example"
      ]

      for path <- surfaces do
        # NOT `assignment_lines/2`: compose.yaml spells it `POOL_SIZE: ${…}`,
        # a YAML key rather than a shell assignment, and it is one of the
        # surfaces that must agree.
        stated =
          path
          |> read!()
          |> normalized_lines()
          |> Enum.filter(&String.starts_with?(&1, "POOL_SIZE"))

        assert stated != [], "#{path}: POOL_SIZE vanished — matcher broken or surface gone"

        refute Enum.any?(stated, &String.contains?(&1, "10")),
               "#{path} still states the old pool default: #{inspect(stated)}"
      end
    end
  end

  describe "the Docker example states the default it actually gets" do
    test "the dirty-scheduler default is documented with its floor" do
      # `bin/start.sh` floors the default at 10 (`if [ "$d" -lt 10 ]`), so
      # a bare `$(nproc)` under-states it on every host with fewer than 10
      # CPUs — which is most of them, and all of the small ones this file
      # is written for.
      source = read!(@docker_example)

      refute source =~ "GRAPPA_DIRTY_SCHEDULERS=$(nproc)",
             ".env.example documents the pre-floor default; bin/start.sh applies max(nproc, 10)"

      assert source =~ "max(nproc, 10)"
    end
  end
end
