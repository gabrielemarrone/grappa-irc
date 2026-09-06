#!/usr/bin/env bats
#
# #1851 — a production checkout that is dirty BY CONSTRUCTION makes every
# release report the unreleased form `X.Y.Z-<sha>`.
#
# `Grappa.Version.GitProbe.facts/1` snapshots `git status --porcelain` at
# COMPILE time, and `Grappa.Version.derive/2` folds a dirty tree into the
# #391 suffix. That suffix is the signal "this build is NOT the tag", and it
# is correct — the defect is upstream of it: the deploy machinery itself
# leaves two entries in the jail's `git status`, so the signal is always on
# and therefore discriminates nothing. Measured on prod across three
# releases (`1.4.0-596d5ea0`, `1.4.1-997711ac`, `1.5.0-35e9fca6`).
#
# The two sources are DIFFERENT and take DIFFERENT cures; this suite pins
# both at the level each one lives at:
#
#   1. `cicchetto/package-lock.json` — untracked. The FreeBSD cic build has
#      an `npm install` fallback (no bun port on FreeBSD) that regenerates
#      it INSIDE the checkout. It is a build artefact of one substrate's
#      toolchain, never a source of truth (`bun.lock` is canonical — see
#      docs/OPERATIONS.md § "cic_build.sh — bun here, npm only on FreeBSD"),
#      so it belongs in `.gitignore` like every other generated path.
#
#   2. `cicchetto/e2e/infra` — a submodule reported modified. `git pull
#      --ff-only` advances the superproject and leaves every submodule
#      working tree exactly where it was, so ONE gitlink bump dirties a
#      deploy checkout permanently. The cure completes the pull.
#
# What each case proves is stated on the case. The BEHAVIOURAL proof for (2)
# — that the flag actually leaves a real checkout clean after a real pull
# across a real gitlink bump — lives in deploy_jail_test.bats, which already
# owns a throwaway upstream + clone; this suite pins the CLASS (every door
# carries it) so a sixth pull site cannot be added without one.

load ../bats_helpers

setup() {
    REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd -P)"
}

# --- source 1: the untracked build artefact --------------------------------

@test "#1851: the FreeBSD cic build's package-lock.json is ignored by the repo" {
    # Deliberately measured against the REAL checkout, not a fixture: the
    # claim IS that this repository's own ignore rules cover the artefact its
    # own deploy writes. A fixture would prove something about the fixture.
    git -C "$REPO" check-ignore -q cicchetto/package-lock.json
}

@test "#1851: package.json is NOT ignored — the rule is scoped, and check-ignore is looking" {
    # Negative control for the case above. Without it a `check-ignore` that
    # matched everything (or a `.gitignore` with a stray `*`) would read as a
    # pass, and a green would prove only that the command ran.
    refute git -C "$REPO" check-ignore -q cicchetto/package.json
}

@test "#1851: bun.lock stays tracked — the canonical lock is not collateral" {
    # The cure must ignore the npm artefact WITHOUT touching the lock the
    # whole toolchain is pinned on. `ls-files` answers from the index, so a
    # rule broad enough to swallow `bun.lock` would show up here as an empty
    # answer even though the file is on disk.
    [ "$(git -C "$REPO" ls-files cicchetto/bun.lock)" = "cicchetto/bun.lock" ]
}

# --- source 2: the submodule left stale by the pull ------------------------

@test "#1851: every deploy pull completes itself with --recurse-submodules=on-demand" {
    # The class guard. Comment lines are excluded (they narrate, they do not
    # pull); log lines are NOT, because a deploy that announces a command it
    # did not run is the log-honesty failure CLAUDE.md bans.
    #
    # `on-demand` and not a bare `--recurse-submodules`: measured, the bare
    # form fetches every submodule on EVERY pull, so a box that cannot reach
    # the submodule remote goes from "deploys fine until the gitlink moves"
    # to "never deploys". `on-demand` is git's own fetch default, so the
    # FETCH half of the pull is byte-for-byte what it does today and only the
    # CHECKOUT half is new — the flag cannot introduce a failure the current
    # pull does not already have.
    cd "$REPO"
    doors="$(git grep -n -- 'git pull --ff-only' -- infra/ | grep -vE ':[[:space:]]*#')"

    # Positive control: an empty census passes every per-line assertion
    # below and would report a green that proves nothing.
    count="$(printf '%s\n' "$doors" | grep -c 'git pull --ff-only')"
    [ "$count" -ge 5 ]

    missing=""
    while IFS= read -r line; do
        case "$line" in
            *--recurse-submodules=on-demand*) ;;
            *) missing="${missing}${line}"$'\n' ;;
        esac
    done <<< "$doors"

    [ -z "$missing" ] || {
        printf 'pull sites missing --recurse-submodules=on-demand:\n%s' "$missing" >&2
        false
    }
}
