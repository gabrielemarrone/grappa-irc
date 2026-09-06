#!/usr/bin/env bats
#
# Bats suite for GH #1949 — a document that offers the release-compose path
# must also give that path's UPDATE command.
#
# There are two pre-built-image boxes, not two ways to drive one:
#
#   get.sh / deploy.sh   plain `docker run`, container `grappa`,
#                        volume `grappa-data`, env at $GRAPPA_HOME/grappa.env
#   compose.release.yaml `docker compose`, project `grappa-release`,
#                        volume `grappa-release_grappa-data`, env inside /data
#
# Both were offered; only the first one's update was ever written down. The
# damage is not cosmetic, and it is worth stating because it decides how hard
# this pin has to be. On a checkout-less host `deploy.sh` auto-selects release
# mode, and its release verbs key off `$GRAPPA_HOME/grappa.env`, which a
# compose install never writes: `update` aborts with "this box was never
# installed. Run 'install' first", and `install` guards only on a container
# named `grappa` — never on the compose one — so it proceeds and stands up a
# SECOND, empty box on a DIFFERENT volume. New database, fresh secrets, and
# every reason to believe the data is gone.
#
# The rule pinned here is deliberately general: it is keyed off the INSTALL
# invocation, so a document that starts offering the compose path tomorrow
# inherits the obligation without anyone remembering this issue. It is not a
# per-file checklist of the two documents #1949 happened to name.
#
# Scope: the claim these documents make, not their prose. Nothing here reads a
# line number — #1949's own body cited five of them and every one had moved.

REPO_ROOT="$BATS_TEST_DIRNAME/../.."

# The command that brings the release compose UP — the offer.
UP_CMD='docker compose -f compose.release.yaml up -d'
# The command that moves it to a newer image — the obligation. `up -d` alone
# is NOT an update: the image ships no Phoenix.CodeReloader and compose will
# not re-resolve a tag it already has locally, so without the `pull` the
# recreate brings the same version back.
PULL_CMD='docker compose -f compose.release.yaml pull'

setup() {
    cd "$REPO_ROOT" || return 1
}

# Tracked files that tell a reader to bring the release compose up. `test/` is
# excluded because this file quotes both commands to search for them, and a
# suite that matches itself would report a green it manufactured.
offering_files() {
    git grep -l -F -- "$UP_CMD" -- ':(exclude)test/' || true
}

@test "the derivation discriminates — a needle that must miss, misses (#1949)" {
    # Negative control. Without it, a `git grep` that had started answering
    # "every tracked file" would satisfy every assertion below by accident.
    bogus="$(git grep -l -F -- 'docker compose -f compose.NOTAFILE.yaml up -d' \
        -- ':(exclude)test/' || true)"
    [ -z "$bogus" ] || {
        echo "the derivation matched a command that appears nowhere:" >&2
        printf '%s\n' "$bogus" >&2
        return 1
    }
}

@test "the derivation is not vacuous — the compose path IS offered (#1949)" {
    # Positive control, and the precondition of the test below: an empty set
    # makes "every offering file also documents the update" trivially true.
    files="$(offering_files)"
    [ -n "$files" ] || {
        echo "no tracked file outside test/ contains: $UP_CMD" >&2
        echo "either the release-compose path was withdrawn (then delete this" >&2
        echo "suite) or the command was reworded (then update UP_CMD)." >&2
        return 1
    }

    # The two documents #1949 was filed about, plus the compose file itself.
    # Named rather than counted: a floor of three is satisfied by any three,
    # and it is these three an operator actually reads.
    for expected in INSTALL.md README.md compose.release.yaml; do
        printf '%s\n' "$files" | grep -qx "$expected" || {
            echo "$expected no longer offers the release-compose path." >&2
            echo "It is the entry point operators are sent to; if the offer" >&2
            echo "genuinely moved, move this expectation with it." >&2
            printf 'offering files:\n%s\n' "$files" >&2
            return 1
        }
    done
}

@test "every file that offers the compose path also documents its update (#1949)" {
    # The whole issue in one assertion: the offer and the update travel
    # together, in the same document, or an operator updates the wrong box.
    missing=''
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        grep -qF -- "$PULL_CMD" "$f" || missing="$missing $f"
    done <<< "$(offering_files)"

    [ -z "$missing" ] || {
        echo "these offer '$UP_CMD' but never say how to update that box:" >&2
        for f in $missing; do echo "  $f" >&2; done
        echo "The documented deploy.sh update does NOT drive a compose box —" >&2
        echo "it aborts, and the abort recommends the 'install' that stands" >&2
        echo "up a second, empty one. Give '$PULL_CMD' in the same document." >&2
        return 1
    }
}

@test "the two boxes are told apart where the choice is made (#1949)" {
    # A reader who cannot name their own box cannot pick the right command,
    # and the two differ in exactly the facts that make the wreck legible:
    # the compose project (hence the container) and the volume it carries.
    # INSTALL.md is where the choice between the paths is offered.
    grep -qF -- 'grappa-release_grappa-data' INSTALL.md || {
        echo "INSTALL.md offers both image paths but never names the volume" >&2
        echo "the compose one uses. That name is what tells an operator" >&2
        echo "staring at an empty box that their data is still on disk." >&2
        return 1
    }
}
