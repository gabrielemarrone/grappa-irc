#!/bin/sh
# previous_release_tag.sh — echo the release tag an operator would be upgrading
# FROM: the highest RELEASE tag that sorts strictly BELOW the tag under test.
#
#   previous_release_tag.sh v1.5.2      -> v1.5.1
#   previous_release_tag.sh v1.3.0-rc2  -> v1.2.0   (a candidate upgrades from
#                                                    the last stable, not from
#                                                    its own sibling candidate)
#   previous_release_tag.sh v0.6.1      -> v0.6.0
#   previous_release_tag.sh v1.3        -> refused, exit 2
#
# The VERDICT goes to stdout as a bare tag, the REASON to stderr — the same
# split `prerelease_flag.sh` uses for its token and `latest_tag_gate.sh` for
# its yes/no.
#
# WHY THIS EXISTS (GH #1952). `release.yml`'s smoke job boots the candidate
# image and probes it, and every probe it has ever run has been a FIRST boot
# on an empty volume of ONE image. The shape that breaks a self-hoster — an
# existing box, running the previous release, updated in place — was never
# crossed, which is how #1945 reached a user's container. Probing it needs the
# previous release's image ref, and that ref must be DERIVED: hardcode it and
# the gate tests the wrong seam one release after it is written.
#
# STRICTLY BELOW, AND THAT IS THE WHOLE DEFINITION. Not "the tag before this
# one in the list" — a backport cut after a newer minor (v0.7.5 landing after
# v0.8.0, the case `latest_tag_gate.sh` already reasons about) sits between
# them in creation order and below both in version order.
#
# PRE-RELEASES ARE NEVER THE ANSWER, whatever they outrank. The upgrade under
# test is the one an operator's automated update performs, and that update
# follows the published stable line; a candidate is a tag most boxes never
# ran. The classifier is `prerelease_flag.sh` — the ONE pre-release classifier
# in this directory (#1636), measured against `Version.parse/1` — and it is
# not written a second time here for the reason `latest_tag_gate.sh` states:
# `v1.4.0+foo-bar` carries a hyphen inside its BUILD metadata and is a
# release, so a hand-rolled `grep -v -- -` would be wrong on it.
#
# WHY A NUMERIC COMPARISON AND NOT `git tag --sort=-v:refname`. The tag under
# test is not necessarily a tag at all. On a `docker_validation` dry-run the
# smoke job runs from a BRANCH whose `VERSION` has never been tagged, and git
# can only order refs it holds — so "where does this version fall among the
# tags" is a question its sort cannot be asked. The three-field compare below
# answers it for any version string, tagged or not.
#
# It is a COMPARISON, not a second classifier: every string it sees has
# already been through `prerelease_flag.sh`, whose shape floor refuses
# anything without three dot-separated all-digit fields. `test -lt` and not
# `$((...))` on purpose — a field with a leading zero (`1.03.0` shape-passes
# there) is an invalid octal constant to POSIX arithmetic and would abort the
# script, while `test` reads it as the decimal it is.
#
# A TAG THIS CANNOT CLASSIFY IS SKIPPED, NOT FATAL — the same posture, and the
# same reasoning, as `latest_tag_gate.sh`: a stray `nightly-2026-08-01` must
# not become a permanent veto, and a tag the classifier refuses never had an
# image published under it, so it cannot be the release anybody is upgrading
# from. The tag UNDER TEST is the opposite case and is refused outright.
#
# NO TAG BELOW IS A REFUSAL, NEVER AN EMPTY LINE. The caller pulls an image
# from what this prints; printing nothing would resolve to `:v` and fail
# somewhere far from the cause. The two ways to get here are told apart in the
# message, because they need different fixes: a checkout with NO `v*` tags is
# a shallow clone that never fetched them (the caller's bug), while a checkout
# full of tags and none below the candidate is the first release of a line.
#
# Caller: the `smoke` job of `.github/workflows/release.yml`. Gate:
# `test/infra/release_upgrade_probe_test.bats`.
#
# POSIX sh, like its siblings `version.sh` / `prerelease_flag.sh` /
# `latest_tag_gate.sh` — the derived dash-parse gate (scripts/posix-parse.sh)
# keys on line 1.
#
# Why: docs/OPERATIONS.md § "Packaging (infra/packaging/)".
set -eu

die() {
	printf 'previous_release_tag.sh: %s\n' "$1" >&2
	exit 2
}

classify="$(dirname "$0")/prerelease_flag.sh"

tag="${1:-}"

[ -n "${tag}" ] || die 'no tag given (usage: previous_release_tag.sh vX.Y.Z)'

# The floor. Without a classifier every tag reads as a release, pre-releases
# included, and the answer could be a candidate nobody deployed.
[ -x "${classify}" ] || die "classifier ${classify} is missing — refusing to pick an upgrade source without it"

# The tag under test is refused rather than skipped: the permissive answer
# here is the one that probes the wrong seam.
"${classify}" "${tag}" >/dev/null ||
	die "cannot classify ${tag} — refusing to pick the release below a tag nobody can read"

# core_of TAG -> X.Y.Z. The leading `v` is the tag's, the `+build` and the
# `-pre` are semver's, and the order of the two strips is semver's too: build
# metadata comes AFTER the pre-release, so a `+` reached first means the
# hyphen behind it belongs to the build. Same order, same reason, as
# `prerelease_flag.sh` — which has already guaranteed what is left is three
# all-digit fields.
core_of() {
	_core="${1#v}"
	case "${_core}" in
	*+*) _core="${_core%%+*}" ;;
	esac
	case "${_core}" in
	*-*) _core="${_core%%-*}" ;;
	esac
	printf '%s\n' "${_core}"
}

# strictly_below A B — true when release core A sorts strictly below core B.
#
# Every `[` sits in an `if` condition and every exit is an explicit `return`:
# a bare failing `[` would be a whole command failing under `set -eu`, which
# aborts the script instead of answering "no".
strictly_below() {
	_a_major="${1%%.*}"
	_a_rest="${1#*.}"
	_a_minor="${_a_rest%%.*}"
	_a_patch="${_a_rest#*.}"
	_b_major="${2%%.*}"
	_b_rest="${2#*.}"
	_b_minor="${_b_rest%%.*}"
	_b_patch="${_b_rest#*.}"

	if [ "${_a_major}" -ne "${_b_major}" ]; then
		if [ "${_a_major}" -lt "${_b_major}" ]; then return 0; else return 1; fi
	fi
	if [ "${_a_minor}" -ne "${_b_minor}" ]; then
		if [ "${_a_minor}" -lt "${_b_minor}" ]; then return 0; else return 1; fi
	fi
	if [ "${_a_patch}" -lt "${_b_patch}" ]; then return 0; else return 1; fi
}

tag_core="$(core_of "${tag}")"

# Captured, not inlined into the `for` word list: a failure there would split
# into zero words and read as "no tags", which is a different diagnosis.
tags="$(git tag -l 'v*')" ||
	die 'git tag -l failed — this must run inside the release checkout'

# Word splitting is what iterates below, and it is safe: `git check-ref-format`
# forbids whitespace in a refname, so no tag can split into two.
best=''
best_core=''
for candidate in ${tags}; do
	if ! candidate_flag="$("${classify}" "${candidate}" 2>/dev/null)"; then
		printf 'skipping %s — the classifier refuses it, so no release was ever published under it\n' "${candidate}" >&2
		continue
	fi
	if [ "${candidate_flag}" != '--prerelease=false' ]; then
		printf 'skipping %s — a pre-release is not the release an operator upgrades FROM\n' "${candidate}" >&2
		continue
	fi

	candidate_core="$(core_of "${candidate}")"
	if ! strictly_below "${candidate_core}" "${tag_core}"; then
		continue
	fi
	if [ -z "${best}" ] || strictly_below "${best_core}" "${candidate_core}"; then
		best="${candidate}"
		best_core="${candidate_core}"
	fi
done

if [ -z "${best}" ]; then
	if [ -z "${tags}" ]; then
		die "this checkout holds no v* tag at all — a shallow clone fetches none, and the release below ${tag} cannot be derived without them"
	fi
	die "no release tag sorts below ${tag} — every v* tag here is above it or is a pre-release, so there is no published release to upgrade FROM"
fi

printf '%s is the release below %s\n' "${best}" "${tag}" >&2
printf '%s\n' "${best}"
