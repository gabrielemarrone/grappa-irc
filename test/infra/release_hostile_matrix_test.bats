#!/usr/bin/env bats
#
# #1952 — the release smoke's HOSTILE-SUBSTRATE MATRIX, the second half of the
# issue's ask ("this is the class gate").
#
# THE SAME COVERAGE PROBLEM `release_upgrade_probe_test.bats` opens with, and
# it is why this file exists at all: probe 8 lives inside `release.yml`'s
# `smoke` job, which fires only on `push: tags: v*` and on `workflow_dispatch`.
# No pull request ever boots a container in that matrix. So a shape that is
# deleted, renamed into nothing, or left unarmed goes unnoticed until a release
# — and a matrix that has quietly lost half its shapes reports the same green
# as one that has all of them.
#
# What these cases CAN claim: that the four shapes #1952 names are wired, that
# each one is ARMED (carries the `docker inspect` check proving the hostile
# condition is actually in force), that each declares the storage ownership its
# operator has to provide, that the shape which blinds probe 7's `docker diff`
# brings its own oracle AND its own canary, and that the volume whose leak
# would make the NEXT run boot stale code is cleaned on both ends.
#
# What they CANNOT claim, and it is deliberate: that any of it BOOTS. Four
# container boots against two published images is the smoke job's work on a
# real tag. The seam is the one `release_image_credits_test.bats` draws between
# reading the recipe and reading the artifact.
#
# HOW THE ARGUMENT CASES WORK, because grep would not have been enough here.
# The driver's `hostile_boot` calls are folded onto one line each and then
# EVALUATED with `hostile_boot` redefined as a recorder. That runs the real
# argument lists through the real quoting, so a shape whose owner argument is
# missing shows up as a flag sitting in `$3` — which is exactly the mistake a
# `grep -q hostile_boot` cannot see.

load ../bats_helpers

setup() {
    REPO_SRC="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    SMOKE="$REPO_SRC/scripts/smoke-release-image.sh"
}

# The driver with backslash-continuations folded away: one logical line per
# statement, quoting untouched. Every case below reads this rather than the
# raw file, because three of the four shapes span several physical lines and a
# line-oriented grep sees only their first.
folded() {
    sed -e :a -e '/\\$/N; s/\\\n[[:space:]]*/ /; ta' "$SMOKE"
}

# The `hostile_boot` INVOCATIONS — column zero, followed by a quote. The
# function's own definition line (`hostile_boot() {`) has a parenthesis there
# instead, so it does not match.
shape_calls() {
    folded | grep -E "^hostile_boot ['\"]"
}

# Evaluate every invocation with `hostile_boot` replaced by a recorder that
# prints the field named by $1 for each call. The driver's own two variables
# are supplied with stand-in values: the cases assert the SHAPE of what is
# passed, never the value the release run would compute.
each_call_field() {
    local field="$1"
    local IMAGE_DATA_OWNER=100:101
    local HOSTILE_UID=65534
    local HOSTILE_APP_VOLUME=grappa-smoke-hostile-app
    # shellcheck disable=SC2317  # called via eval below
    hostile_boot() {
        case "$field" in
            shape) printf '%s\n' "$1" ;;
            arm)   printf '%s\n' "$2" ;;
            owner) printf '%s\n' "$3" ;;
            flags) shift 3; printf '%s\n' "$*" ;;
        esac
    }
    local line
    while IFS= read -r line; do
        eval "$line"
    done < <(shape_calls)
}

@test "#1952 — the extractor really reads the driver's shape calls" {
    # The positive control every case below leans on. An extractor that came
    # back empty would make each of them vacuously true, and this file would
    # report green over a matrix with no shapes left in it at all.
    run shape_calls
    [ "$status" -eq 0 ]
    [ -n "$output" ]

    # Folding is what makes the multi-line shapes visible. Unfolded, the `-v`
    # of the /app shape sits on a physical line of its own and no call line
    # carries it.
    grep -Fq 'HOSTILE_APP_VOLUME' <<<"$output" || {
        printf 'the continuation folding is not working — a shape call spanning\n' >&2
        printf 'several lines came out truncated, so every assertion here is blind.\n' >&2
        printf '%s\n' "$output" >&2
        return 1
    }
}

@test "#1952 — all FOUR hostile shapes the issue lists are wired" {
    # By FLAG, not by prose: the label of a shape is free to be reworded, the
    # flag that makes it that shape is not. One call each.
    local calls; calls="$(shape_calls)"

    grep -Fq -- '--read-only' <<<"$calls" || { printf 'no read-only rootfs shape.\n' >&2; return 1; }
    grep -Fq -- '--workdir /' <<<"$calls" || { printf 'no hostile-cwd shape.\n' >&2; return 1; }
    grep -Fq -- '${HOSTILE_APP_VOLUME}:/app' <<<"$calls" || {
        printf 'nothing mounts a volume over the release root — the shape that\n' >&2
        printf 'blinds probe 7 is gone, and with it the only reader of that\n' >&2
        printf 'property on this substrate.\n' >&2
        return 1
    }
    grep -Eq -- '--user "\$\{HOSTILE_UID\}' <<<"$calls" || {
        printf 'no arbitrary-uid shape. That is the one that reproduces #1945\n' >&2
        printf 'verbatim (File.Error on the RELATIVE "runtime/peer_avatars").\n' >&2
        return 1
    }

    # And exactly four, so a fifth arriving without a case here is a red rather
    # than a silent addition to a matrix nobody re-reads.
    [ "$(wc -l <<<"$calls" | tr -d ' ')" -eq 4 ]
}

@test "#1952 — every shape is ARMED: none of them boots without a docker-inspect check" {
    # An unarmed shape is an ordinary boot wearing a flag. It reports the same
    # green whether docker honoured the flag or dropped it.
    run each_call_field arm
    [ "$status" -eq 0 ]
    [ "$(wc -l <<<"$output" | tr -d ' ')" -eq 4 ]

    local arm
    while IFS= read -r arm; do
        [[ "$arm" == *'{{'*'}}'* ]] || {
            printf 'a shape passes something that is not a docker inspect template\n' >&2
            printf 'as its arm check: %s\n' "$arm" >&2
            return 1
        }
    done <<<"$output"
}

@test "#1952 — every shape declares the ownership its storage must carry" {
    # The argument that would be silently wrong if a new shape copied an older
    # call and dropped a field: `hostile_boot` shifts THREE, so a missing owner
    # puts a flag in its place and the fixture chowns /data to `--read-only`.
    run each_call_field owner
    [ "$status" -eq 0 ]
    [ "$(wc -l <<<"$output" | tr -d ' ')" -eq 4 ]

    local owner
    while IFS= read -r owner; do
        [[ "$owner" =~ ^[0-9]+:[0-9]+$ ]] || {
            printf 'a shape passes %s where the /data owner belongs — a shape that\n' "$owner" >&2
            printf 'forgot the argument shows up here as one of its flags.\n' >&2
            return 1
        }
    done <<<"$output"

    # NEGATIVE CONTROL: the same recorder over a call that DID forget the
    # owner. Without it, a check that accepted everything would read as a pass.
    local IMAGE_DATA_OWNER=100:101
    # shellcheck disable=SC2317  # called via eval below
    hostile_boot() { printf '%s\n' "$3"; }
    local got; got="$(eval "hostile_boot 'forgot' '{{.X}}' --read-only --tmpfs /tmp")"
    refute test "$(printf '%s' "$got")" = "$(printf '%s' "$IMAGE_DATA_OWNER")"
    [[ "$got" =~ ^[0-9]+:[0-9]+$ ]] && {
        printf 'the owner check cannot fail: a call with no owner yielded %s\n' "$got" >&2
        return 1
    }
    [ "$got" = '--read-only' ]
}

@test "#1952 — every shape still carries flags after its three fixed arguments" {
    # A shape with nothing after the owner is not a substrate, it is the
    # ordinary boot probes 1-7 already run.
    run each_call_field flags
    [ "$status" -eq 0 ]

    local flags
    while IFS= read -r flags; do
        [ -n "$flags" ] || {
            printf 'a shape passes no docker flags at all — it boots the image the\n' >&2
            printf 'way every other probe does and asserts nothing new.\n' >&2
            return 1
        }
    done <<<"$output"
}

@test "#1952 — the /app volume is destroyed on BOTH ends, or the next run boots stale code" {
    # The one leak here that is worse than untidy. Docker seeds a named volume
    # from the image only while it is EMPTY, so a leftover /app volume makes
    # the next run mount the previous release over the candidate — measured, a
    # container started from :v1.5.1 on a v1.5.0-seeded volume reports the new
    # tag to `docker inspect` and the OLD version to /api/config.
    local cleanups
    cleanups="$(grep -cE '^\s*docker volume rm .*HOSTILE_APP_VOLUME' "$SMOKE" || true)"
    [ "$cleanups" -ge 2 ] || {
        printf 'the /app volume is removed %s time(s); it must be cleared BEFORE the\n' "$cleanups" >&2
        printf 'run (a crashed earlier run leaves it behind) and in the teardown.\n' >&2
        grep -n 'HOSTILE_APP_VOLUME' "$SMOKE" >&2 || true
        return 1
    }

    # And one of them is in the teardown, which is the arm that runs when a
    # probe FAILS — precisely the run after which a leftover volume is waiting.
    local teardown
    teardown="$(awk '/^teardown\(\) \{/ { inside = 1 } inside { print } inside && /^\}/ { exit }' "$SMOKE")"
    grep -Fq 'docker rm -f' <<<"$teardown" || {
        printf 'the teardown slice came out empty or wrong — this case reads nothing.\n' >&2
        return 1
    }
    grep -Fq 'HOSTILE_APP_VOLUME' <<<"$teardown" || {
        printf 'the teardown does not remove the /app volume. A failing run would\n' >&2
        printf 'leave it behind, and the next run would boot whatever release it\n' >&2
        printf 'still holds while reporting the tag it was asked for.\n' >&2
        return 1
    }
}

@test "#1952 — the shape that blinds docker diff brings its own oracle AND its own canary" {
    # `docker diff` reports the container's read-write layer and never what is
    # under a mount, so on the /app-volume shape it answers zero lines even
    # when the boot wrote into the release root (measured on v1.5.0, whose
    # #1945 defect creates runtime/peer_avatars there). The property is read
    # instead by comparing the release root against the one the image ships.
    grep -Fq 'ls -1A /app | sort' "$SMOKE" || {
        printf 'nothing lists the release root the IMAGE ships, so there is no\n' >&2
        printf 'baseline to compare the post-boot volume against.\n' >&2
        return 1
    }

    # TWO comparisons, in opposite directions, and both are required: the
    # verdict fails when the listings DIFFER, the canary fails when they
    # AGREE after a directory has been planted. A verdict with no canary is
    # the hollow green — an oracle that cannot see anything reports equality
    # forever.
    grep -Fq 'if ! cmp -s "$app_shipped" "$app_after"' "$SMOKE" || {
        printf 'the release-root verdict is missing or spelled differently — the\n' >&2
        printf '/app-volume shape then asserts nothing but /healthz.\n' >&2
        return 1
    }
    grep -Fq 'if cmp -s "$app_shipped" "$app_canary"' "$SMOKE" || {
        printf 'the release-root comparison has no CANARY. An empty or blind\n' >&2
        printf 'listing compares equal to itself, which is the same reading a\n' >&2
        printf 'clean boot produces.\n' >&2
        return 1
    }
    grep -Fq 'mkdir -p /mnt/app/runtime' "$SMOKE" || {
        printf 'the canary does not plant #1945\x27s own path into the volume.\n' >&2
        return 1
    }
}

@test "#1952 — the arbitrary uid is read as arbitrary, and /data's owner is read from the IMAGE" {
    # The shape asserts nothing the moment its uid IS the image's own, so the
    # driver refuses that state rather than reporting a green boot.
    grep -Fq '[ "${HOSTILE_UID}:${HOSTILE_UID}" != "$IMAGE_DATA_OWNER" ]' "$SMOKE" || {
        printf 'nothing stops the arbitrary uid from being the image\x27s baked one.\n' >&2
        printf 'A Dockerfile that moved the user to 65534 would turn the shape into\n' >&2
        printf 'an ordinary boot wearing a --user flag, still green.\n' >&2
        return 1
    }

    # And the owner the other three shapes hand their volume to is READ from
    # the image, never spelled: a literal in CODE is a second copy of a
    # Dockerfile fact, wrong the day `adduser -S` picks another number.
    grep -Fq "stat -c \"%u:%g\" /data" "$SMOKE" || {
        printf 'IMAGE_DATA_OWNER is not read out of the image.\n' >&2
        return 1
    }

    # COMMENTS ARE EXEMPT, deliberately: today's value is a MEASUREMENT and
    # writing it down is what makes the comment worth reading — the driver
    # says `100:101` exactly once, in the sentence explaining why it must not
    # appear anywhere else. Stripping whole-line comments is what separates
    # the two, and the case failed on precisely this before it did.
    #
    # The subject is the fixture's own `chown`, not the whole file: a blanket
    # `[0-9]+:[0-9]+` over the driver would match the default publish address
    # `127.0.0.1:14000` and report a violation that is not one.
    local chown_lines
    chown_lines="$(grep -v '^[[:space:]]*#' "$SMOKE" | grep -F 'chown' || true)"
    [ -n "$chown_lines" ] || {
        printf 'the driver has no chown left in it — the shapes no longer hand\n' >&2
        printf 'their /data volume to anybody, and the arbitrary-uid boot would\n' >&2
        printf 'die on a volume docker re-seeded to the image owner.\n' >&2
        return 1
    }
    refute grep -Eq '[0-9]+:[0-9]+' <<<"$chown_lines"
}
