#!/usr/bin/env bats
#
# #1952 — the release smoke crosses a VERSION SEAM, and the previous release it
# crosses it from is DERIVED.
#
# THE COVERAGE PROBLEM THIS FILE SOLVES. `release.yml` fires on `push: tags:
# v*` and on `workflow_dispatch`, and the upgrade probe lives inside its
# `smoke` job — so no pull request ever executes it. The first real run of
# anything added there is the release itself, which is the worst possible
# place to discover a broken gate: #1951 is that exact story, a probe whose
# pattern had rotted failing the release runs of v1.5.0 AND v1.5.1. The
# mitigation it landed is the one used here — bats that exercise the LOGIC at
# PR time, so what remains untested until the release is only the part that
# genuinely needs a booted container.
#
# What these cases CAN claim:
#   * `previous_release_tag.sh` resolves the release below a version, against
#     real git repositories with real tag sets;
#   * the driver REFUSES to run without an upgrade fixture, rather than
#     quietly reducing itself to the five same-version probes it had;
#   * `release.yml` derives that fixture, pulls it, and hands it over.
#
# What they CANNOT claim, and it is deliberate: that the upgrade BOOTS. That
# needs two published images and a docker daemon, and it stays the smoke job's
# job on a real tag. The seam is the same one `release_image_credits_test.bats`
# draws between reading the recipe and reading the artifact.

load ../bats_helpers

setup() {
    REPO_SRC="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    RESOLVER="$REPO_SRC/infra/packaging/previous_release_tag.sh"
    CLASSIFIER="$REPO_SRC/infra/packaging/prerelease_flag.sh"
    SMOKE="$REPO_SRC/scripts/smoke-release-image.sh"
    WORKFLOW="$REPO_SRC/.github/workflows/release.yml"
}

# A throwaway repository carrying exactly the tags named, and PRODUCTION's own
# two scripts beside each other in it (the resolver resolves its classifier as
# `dirname $0`, so they must stay siblings). Real tags on a real repository,
# never a stubbed `git`: the thing under test is a reading of git's tag list,
# and a stub would only prove that the stub agrees with itself.
tag_repo() {
    # A fresh directory per CALL, not per case: a case building two repos to
    # contrast them would otherwise have the second overwrite the first, and
    # the positive control at the end would read the wrong tag set. (Measured
    # — the first spelling keyed on $BATS_TEST_NUMBER and did exactly that.)
    local root; root="$(mktemp -d "$BATS_TEST_TMPDIR/repo.XXXXXX")"
    mkdir -p "$root/pkg"
    cp "$RESOLVER" "$CLASSIFIER" "$root/pkg/"

    git -C "$root" init -q
    git -C "$root" -c user.email=b@t -c user.name=b commit -q --allow-empty -m seed
    local tag
    for tag in "$@"; do
        git -C "$root" tag "$tag"
    done
    printf '%s\n' "$root"
}

# The resolver, run FROM that repository — its tag list is the input.
#
# TWO helpers, because the script splits its answer across the two streams the
# way `latest_tag_gate.sh` does: the VERDICT on stdout, the REASON on stderr.
# `run` merges them, so a case asserting `$output` = a tag would be comparing
# against the reason line glued to the answer — green or red for reasons that
# have nothing to do with the resolution.
resolve_in() {
    local root="$1"; shift
    ( cd "$root" && ./pkg/previous_release_tag.sh "$@" 2>/dev/null )
}

# The same call with the reason kept, for the cases that assert on it.
resolve_said() {
    local root="$1"; shift
    ( cd "$root" && ./pkg/previous_release_tag.sh "$@" 2>&1 )
}

@test "#1952 — the previous release is the highest tag strictly BELOW the one under test" {
    local root; root="$(tag_repo v1.4.0 v1.4.1 v1.5.0 v1.5.1)"

    run resolve_in "$root" v1.5.2
    [ "$status" -eq 0 ]
    [ "$output" = v1.5.1 ]

    # Not "the tag before this one in creation order", and not "the highest
    # tag": asked about a release in the middle, it answers the one below THAT.
    run resolve_in "$root" v1.5.0
    [ "$status" -eq 0 ]
    [ "$output" = v1.4.1 ]
}

@test "#1952 — a backport cut AFTER a newer minor still resolves by version, not by creation order" {
    # v0.7.5 is tagged last and sorts below v0.8.0. An implementation reading
    # "the tag before this one" off the end of the list would answer v0.7.5
    # for v0.8.1 — an image nobody upgrading to v0.8.1 was running.
    local root; root="$(tag_repo v0.7.0 v0.8.0 v0.8.1 v0.7.5)"

    run resolve_in "$root" v0.8.1
    [ "$status" -eq 0 ]
    [ "$output" = v0.8.0 ]

    # And the backport's OWN previous is the release below it, not the newer
    # minor sitting above.
    run resolve_in "$root" v0.7.5
    [ "$status" -eq 0 ]
    [ "$output" = v0.7.0 ]
}

@test "#1952 — a pre-release is never the release an operator upgrades FROM" {
    local root; root="$(tag_repo v1.2.0 v1.3.0-rc1 v1.3.0-rc2)"

    # The candidates outrank v1.2.0 and are still not the answer: they are
    # tags most boxes never ran, and the upgrade under test is the one an
    # automated update performs along the stable line.
    run resolve_in "$root" v1.3.0
    [ "$status" -eq 0 ]
    [ "$output" = v1.2.0 ]

    # A CANDIDATE upgrades from the last stable too — not from its own sibling
    # candidate, which is the reading `--sort=-v:refname` would hand back.
    run resolve_in "$root" v1.3.0-rc2
    [ "$status" -eq 0 ]
    [ "$output" = v1.2.0 ]
}

@test "#1952 — build metadata is not a pre-release, and its hyphen does not make one" {
    # `1.4.0+foo-bar` carries a hyphen INSIDE its build metadata and is a
    # RELEASE — the row that decided prerelease_flag.sh's implementation, and
    # the row a hand-rolled `grep -v -- -` gets wrong. It must be eligible.
    local root; root="$(tag_repo v1.3.0 v1.4.0+foo-bar)"

    run resolve_in "$root" v1.5.0
    [ "$status" -eq 0 ]
    [ "$output" = 'v1.4.0+foo-bar' ]
}

@test "#1952 — the version under test need not be a tag at all" {
    # The `docker_validation` dry-run runs from a BRANCH whose VERSION has
    # never been tagged. git can only order refs it holds, which is why the
    # resolver compares numerically instead of asking git where this falls.
    local root; root="$(tag_repo v1.5.0 v1.5.1)"

    run resolve_in "$root" v1.6.0
    [ "$status" -eq 0 ]
    [ "$output" = v1.5.1 ]
}

@test "#1952 — a tag the classifier cannot read is skipped, not fatal" {
    # A stray tag must not become a permanent veto over every future release;
    # it also never had an image published under it, so it cannot be the
    # answer. Both halves are asserted: the run SUCCEEDS, and the stray is not
    # what it returns.
    local root; root="$(tag_repo v1.4.0 nightly-2026-08-01 v1.5.0)"

    run resolve_in "$root" v1.6.0
    [ "$status" -eq 0 ]
    [ "$output" = v1.5.0 ]
}

@test "#1952 — RED: an unresolvable previous is a refusal, never an empty line" {
    # The caller interpolates this into an image ref. An empty answer would
    # resolve to `ghcr.io/<owner>/grappa:` and fail somewhere far from here,
    # so both dead ends exit 2 — and they are told apart, because a shallow
    # checkout and a first-of-its-line need different fixes.
    local with_tags; with_tags="$(tag_repo v1.5.0 v1.5.1)"
    run resolve_said "$with_tags" v1.5.0
    [ "$status" -eq 2 ]
    grep -Fq 'no release tag sorts below' <<<"$output"

    local bare; bare="$(tag_repo)"
    run resolve_said "$bare" v1.5.0
    [ "$status" -eq 2 ]
    grep -Fq 'no v* tag at all' <<<"$output"

    # POSITIVE control: the same resolver, the same repository, a version that
    # DOES have a release below it. Without it a resolver broken into always
    # refusing would report both refusals above as a pass.
    run resolve_in "$with_tags" v1.5.2
    [ "$status" -eq 0 ]
    [ "$output" = v1.5.1 ]
}

@test "#1952 — RED: a tag the classifier refuses UNDER TEST is refused outright" {
    # The opposite case from the stray above: skipping the tag being asked
    # about would mean guessing which release it sits after, and the
    # permissive answer is the one that probes the wrong seam.
    local root; root="$(tag_repo v1.4.0 v1.5.0)"

    run resolve_said "$root" v1.5
    [ "$status" -eq 2 ]
    grep -Fq 'cannot classify' <<<"$output"

    run resolve_said "$root" 1.5.1
    [ "$status" -eq 2 ]
    grep -Fq 'cannot classify' <<<"$output"

    # POSITIVE control, same reason as above.
    run resolve_in "$root" v1.5.1
    [ "$status" -eq 0 ]
    [ "$output" = v1.5.0 ]
}

@test "#1952 — RED: without its classifier the resolver refuses rather than treating every tag as a release" {
    # A missing classifier degrades into "no tag is ever a pre-release", which
    # would hand back a release candidate as the thing to upgrade from.
    local root; root="$(tag_repo v1.2.0 v1.3.0-rc2)"
    rm -f "$root/pkg/prerelease_flag.sh"

    run resolve_said "$root" v1.3.0
    [ "$status" -eq 2 ]
    grep -Fq 'classifier' <<<"$output"
}

# ---------------------------------------------------------------------------
# The wiring. Three separate channels, and cutting any one of them leaves the
# release smoke crossing no version seam while every check stays green.

@test "#1952 — the smoke driver REFUSES to run without an upgrade fixture" {
    # `:?` and not a `:-` default: a driver that ran five same-version probes
    # when the fixture was missing would report exactly the green #1952 exists
    # to end.
    grep -qE '^: "\$\{GRAPPA_PREVIOUS_IMAGE:\?' "$SMOKE" || {
        printf 'scripts/smoke-release-image.sh does not REQUIRE GRAPPA_PREVIOUS_IMAGE.\n' >&2
        grep -n 'GRAPPA_PREVIOUS_IMAGE' "$SMOKE" >&2 || true
        return 1
    }
    grep -qE '^: "\$\{GRAPPA_SMOKE_PREVIOUS_VERSION:\?' "$SMOKE" || {
        printf 'the driver does not REQUIRE GRAPPA_SMOKE_PREVIOUS_VERSION — without it\n' >&2
        printf 'nothing checks that the fixture is the OLDER release, and an upgrade\n' >&2
        printf 'from the candidate to itself would pass.\n' >&2
        return 1
    }
}

@test "#1952 — release.yml derives the previous tag, pulls it, and hands both values to the driver" {
    grep -qF 'infra/packaging/previous_release_tag.sh' "$WORKFLOW" || {
        printf 'release.yml no longer calls previous_release_tag.sh — nothing else in\n' >&2
        printf 'the job knows which release the candidate is being upgraded FROM.\n' >&2
        return 1
    }
    grep -qE '^ +GRAPPA_PREVIOUS_IMAGE: \$\{\{ steps\.[a-z_]+\.outputs\.image \}\}$' "$WORKFLOW" || {
        printf 'release.yml does not hand GRAPPA_PREVIOUS_IMAGE to the smoke driver.\n' >&2
        printf 'Resolving the tag and not passing it means the driver refuses to run.\n' >&2
        grep -n 'GRAPPA_PREVIOUS_IMAGE' "$WORKFLOW" >&2 || true
        return 1
    }
    grep -qE '^ +GRAPPA_SMOKE_PREVIOUS_VERSION: \$\{\{ steps\.[a-z_]+\.outputs\.version \}\}$' "$WORKFLOW" || {
        printf 'release.yml does not hand GRAPPA_SMOKE_PREVIOUS_VERSION over.\n' >&2
        grep -n 'GRAPPA_SMOKE_PREVIOUS_VERSION' "$WORKFLOW" >&2 || true
        return 1
    }
}

@test "#1952 — the smoke job fetches tags, or the resolver has nothing to read" {
    # `git tag -l` on the depth-1 checkout this job used to take answers
    # NOTHING, and the resolver would refuse every run. The fix belongs in the
    # checkout, so it is pinned there.
    local smoke_job
    smoke_job="$(awk '/^  smoke:/ { inside = 1; next } /^  [a-z]+:$/ { inside = 0 } inside' "$WORKFLOW")"

    # Guard the extractor before trusting it: an empty slice would make every
    # grep below vacuously fail, or vacuously pass under a negation.
    grep -qF 'smoke-release-image.sh' <<<"$smoke_job" || {
        printf 'the smoke job slice came out empty or wrong — this case is reading nothing.\n' >&2
        return 1
    }
    grep -qE '^ +fetch-tags: true$' <<<"$smoke_job" || {
        printf 'the smoke job checkout does not fetch tags; previous_release_tag.sh\n' >&2
        printf 'would refuse every run with "this checkout holds no v* tag at all".\n' >&2
        return 1
    }
}
