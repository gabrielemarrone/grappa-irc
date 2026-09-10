defmodule Grappa.VersionSingleSourceTest do
  @moduledoc """
  #538/#652 — the version is DECLARED ONCE and everything else DERIVES from it.

  The repo-root `VERSION` file is the single canonical declaration (#652 moved
  it out of `mix.exs` `@version` so a bump hot-reloads instead of forcing a
  COLD restart). Every other carrier is a DERIVATION, not a hand-edited copy:

    * `mix.exs` `@version` + `lib/grappa/version.ex` `@base_version` — both
      read the SAME `VERSION` file at COMPILE time (no hardcoded literal to
      drift; the beam-baked constant is what a hot deploy reloads). NOT the
      OTP application vsn, which since issue 2057 is a frozen constant on
      purpose — it is a code-PATH component (`lib/grappa-<vsn>/ebin`), not a
      version carrier, and the two assertions below pin that split;
    * the `.deb`/nfpm version — `infra/packaging/build.sh` exports
      `GRAPPA_VERSION` from `infra/packaging/version.sh` (which reads
      `VERSION`), and `nfpm.yaml` interpolates `${GRAPPA_VERSION}`;
    * the Arch `pkgver` — `infra/packaging/aur/regen.sh` derives it from the
      same `version.sh` at release time, filling the committed
      `@GRAPPA_VERSION@` sentinel (a MARKER that `regen.sh` has not run —
      not, as this said until #1592, a value `makepkg` bars: its pkgver
      lint accepts `@`, measured, and what would stop an underived build
      is unmeasured).
      DERIVED ≠ EQUAL since #1591: `makepkg` also refuses the hyphen a semver
      pre-release spells its suffix with, so the value goes through
      `aur/pkgver.sh` (`1.3.0-rc1` → `1.3.0rc1`, identity on a bare `X.Y.Z`).
      That is why the same recipe carries a SECOND `@GRAPPA_VERSION@`
      sentinel, `_grappaver`: `pkgver` is the mapped number, `_grappaver` is
      the raw tag, and a pre-release makes them differ;
    * the Arch CLIENT recipe (#1447, `aur/shottino/`) — a SECOND pkgbase, and
      therefore a second carrier: `pkgver=@SHOTTINO_VERSION@` derives from
      `frontends/shottino/version.h` (the client's own line, so
      `shottino --version` and the package agree), while `_grappaver` stays
      `@GRAPPA_VERSION@` because the source tarball only exists under the
      bouncer's tag. Split into two recipes rather than one split package
      because `PKGBUILD(5)` does not let a `package_*()` override `pkgver`;
    * the cicchetto `<meta cicchetto-version>` — `vite.config.ts` reads
      the `GRAPPA_VERSION` env (cic builds mount only `./cicchetto`, so
      they cannot read the repo root; the build wrappers export it from
      `version.sh`), throwing if it is unset.

  This is the drift-catcher the issue asks for, **runnable on a bump commit,
  not only at tag time**: it fails the moment any carrier stops deriving —
  i.e. someone re-hardcodes a competing version literal. It does NOT assert
  the carriers all EQUAL the version (that would be the rejected "bump N
  files, CI yells" shape); it asserts they stay in their SENTINEL/DERIVED
  form, so there is exactly one number to bump: `VERSION`.

  The tag ↔ `VERSION` guard (the human declaration must match the tag being
  cut) lives in `.github/workflows/release.yml`; it needs a tag, so it is a
  release-time check. This test is its bump-commit-runnable complement.
  """
  use ExUnit.Case, async: true

  # The single canonical declaration, read the same way `version.sh` and the
  # release workflow read it — a build↔source cross-check, not a runtime read.
  @canonical_version "VERSION" |> File.read!() |> String.trim()

  # The frozen OTP application vsn (issue 2057). A LITERAL, deliberately
  # duplicated from `mix.exs` rather than derived from it: deriving would make
  # the assertion tautological and blind to the one regression that matters —
  # someone putting `version: @version` back and re-coupling the release code
  # path to the VERSION file. This constant never moves; that is its job.
  @frozen_otp_vsn "0.0.0"

  describe "the single canonical declaration (repo-root VERSION file)" do
    test "is a well-formed semver" do
      assert @canonical_version =~ ~r/^\d+\.\d+\.\d+/
    end

    test "is DECOUPLED from the OTP app vsn, which is frozen (issue 2057)" do
      # This assertion used to be its own opposite: `Application.spec(:grappa,
      # :vsn) == @canonical_version`, pinning the .app vsn to the VERSION file
      # so "the running node's .app would report a version the source never
      # declared" could not happen. That coupling is now deliberately BROKEN,
      # and the pin is kept — inverted — rather than deleted, because the
      # decoupling is the load-bearing property and an accidental re-coupling
      # is silent (vjt's ruling, relayed 2026-09-10).
      #
      # WHY, measured on a real `mix release` + a live node (issue 2057):
      # the app vsn is the ONLY thing that puts a number into the release's
      # code path, `lib/grappa-<vsn>/ebin`. While it tracked VERSION, a bump
      # moved the fresh beams to `lib/grappa-<new>` while the running node
      # kept resolving `:code.lib_dir(:grappa)` to its BOOT directory — so
      # `POST /admin/reload` answered 409 stale_code_path and `/api/config`
      # stayed on the old number. Frozen, the path never moves, the beams land
      # where the node is already looking, and the bump hot-reloads.
      #
      # The reported version does NOT regress: `Grappa.Version.base/0` is the
      # compile-time constant baked from this same VERSION file, so the number
      # an operator reads still has exactly one declaration.
      assert to_string(Application.spec(:grappa, :vsn)) == @frozen_otp_vsn
    end

    test "the RELEASE vsn inherits the freeze — never its own version: key (issue 2057)" do
      # The constraint that makes the freeze work, and the one way to undo it
      # silently. `Grappa.HotReload.audit_code_path/1` compares the app vsn it
      # reads off the booted code path (`lib/grappa-<app vsn>`) against the
      # RELEASE vsn in `releases/start_erl.data`. They agree today only because
      # a release with no `version:` of its own inherits the app's.
      #
      # MEASURED on the bench, not reasoned: freezing the app vsn while leaving
      # `releases: [grappa: [version: @version]]` produced
      # `409 {"booted":"0.0.0","built":"1.5.6"}` — and since the frozen side
      # never moves while the other tracks VERSION, that 409 is PERMANENT. The
      # cure would have become a total, silent refusal of every hot deploy.
      release_opts = Keyword.fetch!(Mix.Project.config()[:releases], :grappa)

      refute Keyword.has_key?(release_opts, :version),
             "the grappa release must inherit the frozen app vsn; giving it a " <>
               "version: of its own makes audit_code_path/1 refuse every hot deploy"
    end

    test "mix.exs @version DERIVES from VERSION — never a re-hardcoded literal (#652)" do
      # The core #652 guarantee: mix.exs stopped being the hand-edited carrier.
      # If someone re-inlines `@version \"X.Y.Z\"` the bump starts editing
      # mix.exs again, which Preflight classifies COLD (mix_deps?) — catch that
      # regression at the bump commit. Note this is about the BUMP CARRIER and
      # is untouched by issue 2057, which froze a DIFFERENT attribute
      # (`@otp_vsn`, the OTP app vsn) while leaving `@version` deriving.
      mix = File.read!("mix.exs")
      refute mix =~ ~r/@version\s+"\d/
      assert mix =~ "File.read!(Path.join(__DIR__, \"VERSION\"))"
    end

    test "version.sh (the shared derivation primitive) echoes it" do
      # build.sh + release.yml both derive the version through this script.
      # Invoke via `sh` (not `bash`): version.sh is POSIX #!/bin/sh, and the
      # dev/test container is the alpine/musl image, which ships busybox
      # /bin/sh but no bash — the same reason version.sh avoids bash-isms so
      # the FreeBSD jail can run it. Explicit interpreter so a stripped +x bit
      # can't mask a broken grep.
      #
      # env: only PATH (so the script's grep/sed/head resolve) — sensitive
      # vars (SECRET_KEY_BASE, CLOAK_KEY, …) are NOT inherited by the
      # subprocess, mirroring Grappa.Version's git call (Credo UnsafeExec).
      {out, 0} =
        System.cmd("sh", ["infra/packaging/version.sh"],
          env: [{"PATH", System.get_env("PATH") || "/usr/bin:/bin"}],
          stderr_to_stdout: true
        )

      assert String.trim(out) == @canonical_version
    end
  end

  describe "every other carrier stays a DERIVATION, never a hand-edited copy" do
    test "nfpm.yaml interpolates ${GRAPPA_VERSION} (fed by build.sh)" do
      version_line = carrier_value("infra/packaging/nfpm.yaml", ~r/^version:\s*(\S+)\s*$/m)
      assert version_line == "${GRAPPA_VERSION}"
    end

    test "PKGBUILD pkgver stays the @GRAPPA_VERSION@ sentinel, never a derived number" do
      # The name used to carry a parenthetical crediting the sentinel's
      # safety net to makepkg's pkgver lint — which measurably accepts '@'
      # (#1592). The assertion never depended on it: this pins the CARRIER'S
      # SHAPE, which is all it ever pinned. So the mechanism came OUT of the
      # name rather than a correct one going in, because which stage stops
      # an underived build is not measured. The recipe's pkgver comment says
      # exactly that, and is the one place to keep it.
      pkgver = carrier_value("infra/packaging/aur/PKGBUILD", ~r/^pkgver=(.+)$/m)
      assert pkgver == "@GRAPPA_VERSION@"
    end

    test "the bouncer PKGBUILD names its source TAG through _grappaver (#1591)" do
      # Same sentinel, second carrier — and the pair is not redundant. Since
      # #1591 `pkgver` is the version MAPPED for makepkg (which refuses the
      # hyphen a semver pre-release carries) while `_grappaver` is the raw tag,
      # so a pre-release makes the two DIFFER. A recipe that went back to
      # spelling its source `v${pkgver}` would fetch a tag nobody ever cut.
      pkgbuild = File.read!("infra/packaging/aur/PKGBUILD")

      assert carrier_value("infra/packaging/aur/PKGBUILD", ~r/^_grappaver=(.+)$/m) ==
               "@GRAPPA_VERSION@"

      assert carrier_value("infra/packaging/aur/PKGBUILD", ~r/^source=\((.+)\)$/m) =~
               "v${_grappaver}.tar.gz"

      refute pkgbuild =~ ~r/^source=.*v\$\{pkgver\}/m
    end

    test ".SRCINFO pkgver is the @GRAPPA_VERSION@ sentinel (regenerated with PKGBUILD)" do
      pkgver = carrier_value("infra/packaging/aur/.SRCINFO", ~r/pkgver\s*=\s*(\S+)/)
      assert pkgver == "@GRAPPA_VERSION@"
    end

    test "the Arch client PKGBUILD pkgver is the @SHOTTINO_VERSION@ sentinel (#1447)" do
      # A DIFFERENT carrier from every other line here: the client's number
      # lives in frontends/shottino/version.h and moves on its own cadence.
      # Hard-coding it would be the same drift this suite exists to catch, one
      # package over — and it would go unnoticed longer, since nothing else in
      # the tree reads that number.
      pkgver = carrier_value("infra/packaging/aur/shottino/PKGBUILD", ~r/^pkgver=(.+)$/m)
      assert pkgver == "@SHOTTINO_VERSION@"
    end

    test "the Arch client recipe still names the GRAPPA tag as its source (#1447)" do
      # Not a duplicate of the assertion above — the opposite failure. One
      # repository, one tag: the tarball exists under the BOUNCER's version, so
      # a recipe that derived its source from the client's line would fetch a
      # tag that was never cut. Two sentinels, two carriers, one tarball.
      grappaver = carrier_value("infra/packaging/aur/shottino/PKGBUILD", ~r/^_grappaver=(.+)$/m)
      assert grappaver == "@GRAPPA_VERSION@"
    end

    test "the Arch client .SRCINFO carries both sentinels (regenerated with its PKGBUILD)" do
      # The committed .SRCINFO is hand-written until the arch job regenerates
      # it; nothing in this suite compares it to its PKGBUILD field by field,
      # so this pins the two values a hand-edit gets wrong first.
      srcinfo = "infra/packaging/aur/shottino/.SRCINFO"
      assert carrier_value(srcinfo, ~r/pkgver\s*=\s*(\S+)/) == "@SHOTTINO_VERSION@"
      assert carrier_value(srcinfo, ~r/source\s*=\s*\S*tags\/v(\S+)\.tar\.gz/) == "@GRAPPA_VERSION@"
    end

    # The cicchetto carrier — package.json's version neutralised to 0.0.0 (vite
    # bakes GRAPPA_VERSION into <meta cicchetto-version> instead) — is guarded
    # on the CIC side, cicchetto/src/__tests__/versionSource.test.ts. It lives
    # there because the worktree overlay mounts cicchetto/src (not
    # cicchetto/package.json) into the Elixir test container, so reading it here
    # would assert against main's copy, not the change under test.
  end

  # Extract the first capture group of `re` from the file at `path`, failing
  # with a clear message when the carrier line is missing entirely.
  defp carrier_value(path, re) do
    contents = File.read!(path)

    case Regex.run(re, contents) do
      [_, value] -> value
      nil -> flunk("no line matching #{inspect(re)} in #{path}")
    end
  end
end
