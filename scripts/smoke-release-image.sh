#!/usr/bin/env bash
# smoke-release-image.sh — deploy the published release image FOR REAL, then
# ask it questions (#1162).
#
# test/infra/*.bats covers the deploy SCRIPTS with `docker` stubbed on PATH:
# every assertion there is about which file a verb writes and which flags it
# would pass. Nothing boots the image. #1161 is the bug class that costs:
# the container starts, the API answers, the env is well-formed, every script
# did its job — and the frontend is 404 because a variable pointed one
# directory to the left. No script-level assertion can see it; one HTTP GET
# can.
#
# This is that GET, plus the discovery, secret-persistence, account-bootstrap
# and credit-roll probes, against a container that was
# brought up by the SAME infra/docker/get.sh -> deploy.sh path an operator
# runs (GRAPPA_RAW_BASE points get.sh at this checkout instead of GitHub raw,
# so the mirror step is exercised too — a file get.sh forgets to mirror is
# itself a shipped-deploy bug).
#
#   usage:  docker pull ghcr.io/vjt/grappa:vX.Y.Z
#           docker pull ghcr.io/vjt/grappa:v<previous>
#           GRAPPA_IMAGE=ghcr.io/vjt/grappa:vX.Y.Z \
#           GRAPPA_PREVIOUS_IMAGE=ghcr.io/vjt/grappa:v<previous> \
#           GRAPPA_SMOKE_VERSION=X.Y.Z \
#           GRAPPA_SMOKE_PREVIOUS_VERSION=<previous> \
#             scripts/smoke-release-image.sh
#
#   GRAPPA_IMAGE                   (required) the image ref under test, already local.
#   GRAPPA_SMOKE_VERSION           (required) the version the running node must report.
#   GRAPPA_PREVIOUS_IMAGE          (required) the release BEFORE it, already local —
#                                  the image probe 6 upgrades FROM. Resolved by
#                                  infra/packaging/previous_release_tag.sh, never
#                                  hardcoded: a pinned previous makes this gate test
#                                  the wrong seam one release after it is written.
#   GRAPPA_SMOKE_PREVIOUS_VERSION  (required) the version THAT image must report before
#                                  the upgrade — the control that the fixture really is
#                                  the older release and not a second copy of the
#                                  candidate, which would make probe 6 assert nothing.
#   GRAPPA_SMOKE_PUBLISH           host:port to publish on (default 127.0.0.1:14000).
#
# ⚠️ Probe 5 asserts a RELEASE build. An image from a plain
#    `docker build -f Dockerfile.release .` legitimately bakes the degraded
#    credit roll (`.git` is .dockerignore'd, #1834) and will fail it — pass
#    `--build-arg GRAPPA_CREDITS="$(infra/packaging/credits.sh)"` to build the
#    thing release.yml builds. That asymmetry is the point: the naked build
#    must keep DEGRADING, the shipped image must not.
#
# A MISSING IMAGE IS A FAILURE, NEVER A SKIP: a smoke test that quietly passes
# when it tested nothing is worse than no smoke test. Same for every probe —
# the first one that fails dumps the container log and exits non-zero.
#
# What this does NOT cover, deliberately:
#   * one arch only — whatever the host runs. The arm64 leg of a multi-arch
#     manifest is proven by the build, not by this.
#   * no IRC: no upstream connect, no SASL, no scrollback. Those are
#     scripts/integration.sh's job, against the SOURCE image.
#   * no TLS front door, no reverse proxy, no real PHX_HOST — the box is
#     probed on the published loopback port.
#   * `update` is not exercised, only `install` + a bare-run restart.
#   * ONE direction only: previous -> candidate. A downgrade is a different
#     question with a different answer (a migration that ran is not undone by
#     booting the older image) and is not smuggled in here (#1952).
#   * an EMPTY BIND MOUNT over /app is not a shape and cannot be one: docker
#     never copies the image's content into a bind mount, so the release is
#     simply gone. Measured — the container does not fail to boot, it fails to
#     be CREATED: `stat /app/release-entrypoint.sh: no such file or directory`,
#     status `created/127`. The named-volume reading of the same words IS
#     covered, as shape 3 below; the two are different substrates wearing one
#     sentence, and only one of them has an application in it to test.

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/.." && pwd)"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }
pass() { printf '\033[1;32mok\033[0m  %s\n' "$*"; }

: "${GRAPPA_IMAGE:?set GRAPPA_IMAGE to the image ref under test}"
: "${GRAPPA_SMOKE_VERSION:?set GRAPPA_SMOKE_VERSION to the version the node must report}"
: "${GRAPPA_PREVIOUS_IMAGE:?set GRAPPA_PREVIOUS_IMAGE to the release image probe 6 upgrades FROM}"
: "${GRAPPA_SMOKE_PREVIOUS_VERSION:?set GRAPPA_SMOKE_PREVIOUS_VERSION to the version that image must report}"
PUBLISH="${GRAPPA_SMOKE_PUBLISH:-127.0.0.1:14000}"

# Dedicated names, never the operator defaults (`grappa` / `grappa-data`): the
# teardown below force-removes them, and it must not be able to eat a real box.
BOX=grappa-smoke
BOX_VOLUME=grappa-smoke-data
BARE=grappa-smoke-bare
BARE_VOLUME=grappa-smoke-bare-data
# The version seam (#1952). TWO container names on ONE volume: the previous
# release writes the state, the candidate inherits it. Naming them separately
# is what keeps both logs readable in the teardown dump — the interesting
# failure is "the candidate did not come up", and the OLD container's log is
# half the evidence for why.
UP_OLD=grappa-smoke-upgrade-old
UP_NEW=grappa-smoke-upgrade-new
UP_VOLUME=grappa-smoke-upgrade-data
# The hostile-substrate matrix (#1952). One name reused across the shapes,
# each on its own fresh volume, because they run one at a time and a shared
# name keeps the teardown list finite.
HOSTILE=grappa-smoke-hostile
HOSTILE_VOLUME=grappa-smoke-hostile-data
# Shape 3's SECOND volume, the one mounted over the release root itself.
#
# ⚠️ THIS ONE MUST NEVER SURVIVE A RUN, and it is the only volume here whose
# leak is worse than untidy. Docker seeds a named volume from the image ONCE,
# while it is empty; a leftover /app volume is not empty, so the next run's
# container mounts LAST RUN'S RELEASE over the candidate's and boots it.
# Measured: a container started from `:v1.5.1` on a volume seeded by v1.5.0
# reports `.Config.Image = …:v1.5.1` to `docker inspect` and version `1.5.0` to
# /api/config. The whole smoke would then probe an image nobody built, and say
# nothing about it — so it is removed before the run AND in the teardown.
HOSTILE_APP_VOLUME=grappa-smoke-hostile-app

# The account created under the PREVIOUS release, read back after the upgrade
# through the same operator door — see probe 6.
UP_CARRIER=release-smoke-upgrade-carrier

command -v docker >/dev/null 2>&1 || die "docker not found."
docker image inspect "$GRAPPA_IMAGE" >/dev/null 2>&1 \
    || die "$GRAPPA_IMAGE is not present locally — 'docker pull' it first. An unavailable image fails this job; it never skips it."
# Same posture for the upgrade fixture, and for the same reason: an absent
# previous image must fail this run, never quietly reduce it to the five
# same-version probes it already had.
docker image inspect "$GRAPPA_PREVIOUS_IMAGE" >/dev/null 2>&1 \
    || die "$GRAPPA_PREVIOUS_IMAGE is not present locally — 'docker pull' it first. The upgrade probe has no fixture without it, and a smoke run that silently skips the version seam is the state #1952 exists to end."
[ "$GRAPPA_IMAGE" != "$GRAPPA_PREVIOUS_IMAGE" ] \
    || die "GRAPPA_PREVIOUS_IMAGE is the same ref as GRAPPA_IMAGE — probe 6 would 'upgrade' an image to itself and prove nothing."

SMOKE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/grappa-smoke.XXXXXX")"

teardown() {
    status=$?
    if [ "$status" -ne 0 ]; then
        # The server half of the failure: a probe that failed on the HTTP side
        # says nothing about why. 200 lines, not 30.
        for c in "$BOX" "$BARE" "$UP_OLD" "$UP_NEW" "$HOSTILE"; do
            if docker inspect "$c" >/dev/null 2>&1; then
                printf '\n----- docker logs %s (tail 200) -----\n' "$c" >&2
                docker logs --tail 200 "$c" >&2 || true
            fi
        done
    fi
    docker rm -f "$BOX" "$BARE" "$UP_OLD" "$UP_NEW" "$HOSTILE" >/dev/null 2>&1 || true
    docker volume rm "$BOX_VOLUME" "$BARE_VOLUME" "$UP_VOLUME" "$HOSTILE_VOLUME" "$HOSTILE_APP_VOLUME" >/dev/null 2>&1 || true
    rm -rf "$SMOKE_HOME"
    exit "$status"
}
trap teardown EXIT

# A crashed earlier run leaves the box behind, and `install` refuses to run
# onto an existing container. Clear the dedicated names before, not just after.
docker rm -f "$BOX" "$BARE" "$UP_OLD" "$UP_NEW" "$HOSTILE" >/dev/null 2>&1 || true
docker volume rm "$BOX_VOLUME" "$BARE_VOLUME" "$UP_VOLUME" "$HOSTILE_VOLUME" "$HOSTILE_APP_VOLUME" >/dev/null 2>&1 || true

# wait_healthz CONTAINER WHAT — poll /healthz from INSIDE, so this works for
# the bare container too (no published port). WHAT names the shape being
# waited on, not the container: since #1952 the same driver waits on the boots
# of several different shapes, and "grappa-smoke-hostile never answered" would
# not say WHICH hostile substrate it was. Both arguments are required — a
# defaulted label is a failure message that degrades exactly when it is needed.
# The count is deliberately not spelled here: it went from two to four in one
# follow-up, and a number in a comment is a thing to forget.
wait_healthz() {
    deadline=$((SECONDS + 300))
    until docker exec "$1" curl -fsS -o /dev/null http://localhost:4000/healthz 2>/dev/null; do
        [ "$SECONDS" -lt "$deadline" ] || die "$2 ($1) never answered /healthz"
        printf '.'; sleep 2
    done
    printf '\n'
}

# migration_count IMAGE — how many migration files that image SHIPS.
#
# Read out of the release's own priv directory, with the vsn in the path left
# to a glob: spelling it would be a second copy of VERSION, and this has to
# work on an image whose version is precisely the one we do not want to state
# twice. A throwaway container with the entrypoint overridden, so nothing
# boots and no volume is touched.
migration_count() {
    docker run --rm --entrypoint sh "$1" \
        -c 'ls -1 lib/grappa-*/priv/repo/migrations/*.exs 2>/dev/null | wc -l' \
        | tr -cd '0-9'
}

say "installing via infra/docker/get.sh (release mode) from $GRAPPA_IMAGE"
# get.sh mirrors deploy_common.sh + gen-secrets.sh + deploy.sh into
# GRAPPA_HOME and execs deploy.sh, exactly as `curl … | bash` does; the
# file:// base is the only substitution, so the mirror list is under test.
GRAPPA_RAW_BASE="file://$REPO_ROOT" \
GRAPPA_HOME="$SMOKE_HOME" \
GRAPPA_CONTAINER="$BOX" \
GRAPPA_DATA_VOLUME="$BOX_VOLUME" \
GRAPPA_PUBLISH="$PUBLISH" \
GRAPPA_IMAGE="$GRAPPA_IMAGE" \
PHX_HOST=localhost \
    sh "$REPO_ROOT/infra/docker/get.sh" install

# ---- probe 1: the SPA the box serves can actually boot ---------------------
#
# Three claims, three INDEPENDENT oracles — deliberately not a comparison
# between two reads of one file. Asking the node for Cic.Bundle.current_hash()
# and grepping the response for it looks like a cross-check and is not: both
# sides resolve Bundle.root() and open the same index.html, so they cannot
# disagree and the assertion can never fail. So the hash is parsed FROM THE
# HTTP RESPONSE, by shipping the received bytes back into the container and
# running the production parser (Cic.Bundle.parse_hash/1, exposed for exactly
# this) over them — no second copy of the Vite regex to drift.
#
#   (a) GET / is 2xx            — #1161's 404 SPA (a missing bundle is a 404;
#                                 the "not built" text rides WITH that status)
#   (b) the body parses to a hash — a shell served 200 that boots nothing
#   (c) the chunk it names arrives AS JAVASCRIPT — a shell pointing at bytes
#       nobody serves. Status alone is blind here, MEASURED: delete
#       cicchetto-dist/assets from the image and GET /assets/index-<hash>.js
#       still answers 200, because Plug.Static misses and the SPA history
#       fallback hands back the shell with content-type text/html. The
#       browser then loads the page, fetches the module, gets HTML, and
#       white-screens — the exact silent shape of #1161.
say "probe 1: the SPA served at / can boot"
body="$SMOKE_HOME/index.html"
curl -fsS --max-time 20 -o "$body" "http://$PUBLISH/" \
    || die "GET / did not return 2xx"

docker cp "$body" "$BOX:/tmp/smoke-index.html" >/dev/null
bundle_hash="$(docker exec "$BOX" bin/grappa rpc \
    'IO.puts("cic-hash=" <> to_string(Grappa.Cic.Bundle.parse_hash(File.read!("/tmp/smoke-index.html"))))' \
    | sed -n 's/^cic-hash=//p' | tail -n1 | tr -d '\r')"
[ -n "$bundle_hash" ] || {
    printf '\n----- GET / returned (first 300 bytes) -----\n' >&2
    head -c 300 "$body" >&2; printf '\n' >&2
    die "GET / returned 200 but carries no SPA bundle tag"
}

chunk_type="$(curl -fsS --max-time 20 -o /dev/null \
    -w '%{content_type}' "http://$PUBLISH/assets/index-${bundle_hash}.js")" \
    || die "the shell names /assets/index-${bundle_hash}.js and the box does not serve it"
case "$chunk_type" in
    *javascript*) ;;
    *) die "/assets/index-${bundle_hash}.js came back as '${chunk_type}', not JavaScript — the shell boots nothing" ;;
esac
pass "GET / serves a shell that boots index-${bundle_hash}.js (${chunk_type})"

# ---- probe 2: /api/config answers, and the node is the image under test ----
#
# One request, two claims: the unauthenticated discovery endpoint is reachable
# at all, and the version it reports is the one this image was built for. The
# version half is what catches "the tag you think you deployed is not the
# image that is running".
say "probe 2: GET /api/config is the discovery JSON for $GRAPPA_SMOKE_VERSION"
config="$(curl -fsS --max-time 20 "http://$PUBLISH/api/config")" \
    || die "GET /api/config did not return 2xx"
grep -Fq '"server":"grappa"' <<<"$config" \
    || die "GET /api/config is not grappa's discovery JSON: $config"
grep -Fq "\"version\":\"$GRAPPA_SMOKE_VERSION\"" <<<"$config" \
    || die "the running node does not report $GRAPPA_SMOKE_VERSION: $config"
pass "/api/config reports $GRAPPA_SMOKE_VERSION"

# ---- probe 3: a restart never rotates the generated secrets ----------------
#
# A SECOND container shape, and it has to be: under deploy.sh every secret
# rides in from the host env file, so the entrypoint's first-boot bootstrap
# (#862) never fires there. A bare `docker run` with only PHX_HOST set is the
# path that generates them onto /data — and rotating GRAPPA_ENCRYPTION_KEY on
# a restart is silent data loss (every stored credential stops decrypting),
# not a failed boot, so nothing louder than this would notice.
say "probe 3: bare 'docker run' bootstraps secrets, and a restart reuses them"
docker run -d --name "$BARE" -e PHX_HOST=localhost \
    -v "${BARE_VOLUME}:/data" "$GRAPPA_IMAGE" >/dev/null
wait_healthz "$BARE" "the bare first boot"
before="$(docker exec "$BARE" sha256sum /data/grappa.env | cut -d' ' -f1)"
[ -n "$before" ] || die "no /data/grappa.env after first boot — the bootstrap never ran"

docker restart "$BARE" >/dev/null
wait_healthz "$BARE" "the bare restart"
after="$(docker exec "$BARE" sha256sum /data/grappa.env | cut -d' ' -f1)"
[ "$before" = "$after" ] \
    || die "the restart ROTATED /data/grappa.env ($before -> $after) — every stored credential is now undecryptable"
pass "/data/grappa.env survived the restart byte-for-byte ($before)"

# ---- probe 4: docker exec can bootstrap the first account ------------------
#
# The bare image generated secrets inside its entrypoint process. Docker does
# NOT add those exports to Config.Env, so a later `docker exec` starts without
# them — exactly the documented first-account door. The packaged CLI must
# re-enter the same safe, line-parsing entrypoint before runtime.exs loads.
# Feed the password on stdin: putting it behind --password would make this test
# teach operators to leak credentials through shell history + the process list.
say "probe 4: docker exec creates the first admin from a fresh-volume boot"
created="$(printf 'release-smoke-password\n' \
    | docker exec -i "$BARE" bin/grappa create-user release-smoke-admin --admin)" \
    || die "docker exec create-user failed after first-boot secrets were generated on /data"
grep -Fq 'created user release-smoke-admin' <<<"$created" \
    || die "docker exec create-user returned success without naming the created account: $created"
grep -Fq '[admin]' <<<"$created" \
    || die "docker exec create-user did not grant the requested admin flag: $created"
pass "docker exec created release-smoke-admin [admin] without a password argument"

# ---- probe 5: the shipped SPA carries the build's REAL credit roll ---------
#
# #1834. `.git` is .dockerignore'd for Dockerfile.release, so the credits.sh
# call INSIDE the image build can only reach its own no-repo guard and answer
# `{"sha":null,"date":null,"contributors":[]}` — which is what ghcr was
# shipping. release.yml now derives the payload on the runner (which HAS the
# history) and hands it in as a build arg. Nothing else in CI can see whether
# that arrived: the unit suite runs under a vitest config with no `define` at
# all, and the #1773 e2e spec builds its own bundle from a full checkout. This
# probe is the only oracle that reads the artifact that ships.
#
# The dist, not the wire: probe 1 already proved the shell and its entry chunk
# are SERVED. Which chunk the payload lands in is rolldown's business, and
# pinning it here would make this a code-splitting test — so this asks the
# container for every chunk it ships, resolving the root from the image's own
# CIC_DIST_ROOT rather than a second copy of the path.
#
# THREE outcomes, not two. "Populated" and "degraded" are the two that name a
# verdict; the third — neither shape present — means the payload's spelling
# moved and this probe went blind, and it FAILS rather than passing quietly.
# That is the anti-hollow-green guard, and it doubles as the positive control:
# the same greps that must reject the degraded roll must also be able to FIND
# one.
say "probe 5: the SPA the image ships carries a populated credit roll"
shipped_js="$SMOKE_HOME/shipped-chunks.js"
# `sed` folds the escaped spelling onto the bare one: the minifier picks the
# cheapest delimiter for the string literal it bakes the payload into —
# backticks in the build measured for #1834, which leaves the JSON's own
# quotes bare, but a `"` delimiter would escape every one of them. Neither
# assertion below should depend on that choice. `set -o pipefail` above is
# what keeps a failed `docker exec` from being masked by the sed.
docker exec "$BOX" sh -c 'cat "$CIC_DIST_ROOT"/assets/*.js' | sed 's/\\"/"/g' > "$shipped_js" \
    || die "could not read the shipped JS chunks out of $BOX"

# The exact payload credits.sh emits with no repo — canonical, because
# vite.config.ts re-serialises it through JSON.parse/stringify.
degraded_roll='{"sha":null,"date":null,"contributors":[]}'
# One contributor row. Absent from a degraded bundle and present once per
# credited author in a populated one — measured 0 vs 9 on the two dists #1834
# built to check exactly this.
#
# #1951 — the middle key is #1927's `nick`, and it is NOT always a quoted
# string: `credits.sh`'s `nickof()` emits the BARE `null` token for an author
# missing from `infra/packaging/contributors`, and a tree that has no table at
# all emits `null` for every row. The alternation carries both spellings —
# accepting only the quoted one would leave this probe blind to half the field
# and, on a tree without the table, to all of it.
#
# Deliberately STRICT, not permissive: it admits exactly the two shapes the
# deriver can emit, so the "neither shape present" branch below still fires
# the next time the payload's spelling moves. Loosening it to match anything
# would restore the hollow green that branch exists to refuse — which is the
# opposite of the bug. Pinned by `test/infra/release_image_credits_test.bats`
# against payloads `credits.sh` really produces, so the next spelling change
# lands on a PR-time red instead of on the release run: this pattern going
# stale is what made probe 5 the only red check on v1.5.0 and v1.5.1.
contributor_row='\{"name":"[^"]*","nick":(null|"[^"]*"),"commits":[0-9]+\}'
# The whole populated payload, head-anchored: a real sha, a real date, and at
# least one contributor. All three, because each degrades on its own — a roll
# that names the commit and credits nobody is still an empty roll.
populated_roll='\{"sha":"[0-9a-f]+","date":"[^"]+","contributors":\['"$contributor_row"

if grep -qF "$degraded_roll" "$shipped_js"; then
    die "the image bakes the DEGRADED credit roll ($degraded_roll) — the build ran credits.sh in a context with no .git and nothing passed GRAPPA_CREDITS in (#1834)"
fi

if ! grep -qE "$populated_roll" "$shipped_js"; then
    die "the shipped chunks carry NEITHER a populated credit roll nor the degraded one — the payload's spelling changed and this probe is now blind (#1834); check the vite define in cicchetto/vite.config.ts"
fi

roll_sha="$(grep -oE '\{"sha":"[0-9a-f]+"' "$shipped_js" | head -n1 | sed 's/.*"sha":"//; s/"$//')"
# `grep -c` counts LINES and the bundle is minified onto a handful of them, so
# it would report 1 for any roll of any size. Count MATCHES.
roll_people="$(grep -oE "$contributor_row" "$shipped_js" | wc -l | tr -d ' ')"
pass "the shipped bundle credits commit ${roll_sha} and ${roll_people} contributor row(s)"

# ---- probe 6: the VERSION SEAM — the previous release, upgraded in place ----
#
# #1952. Every probe above runs ONE image on state that image itself created:
# probe 3 is the closest thing to an upgrade and it restarts the SAME image, so
# the version seam is never crossed. The shape that broke #1945 in the field is
# the other one — an existing box, running the previous release, updated in
# place — and it is the shape a self-hoster's automated update takes.
#
# So: boot `$GRAPPA_PREVIOUS_IMAGE` on a fresh volume, let it bootstrap, write
# state through it, stop it, and start the CANDIDATE on that same volume. The
# direction is one-way on purpose (see the non-coverage list at the top).
say "probe 6: $GRAPPA_SMOKE_PREVIOUS_VERSION boots, then $GRAPPA_SMOKE_VERSION inherits its volume"

# Derived BEFORE anything boots, and from the images rather than from the
# repository: how many migrations each one ships. The difference is exactly
# how many the upgrade must run, because the previous image booted on an EMPTY
# volume and auto-migrated, so what is applied down there is precisely its own
# set. This is the #1945 canary without naming a migration — naming one
# (`CreatePeerAvatars`) would go stale the release after it is written.
cand_migrations="$(migration_count "$GRAPPA_IMAGE")"
prev_migrations="$(migration_count "$GRAPPA_PREVIOUS_IMAGE")"
# The anti-hollow-green guard, same posture as probe 5's third branch: zero
# files means the release's priv layout moved and the count is blind, not that
# a release ships no schema.
# An `if` and not `A && B || die`: with that spelling the die runs when A is
# TRUE and B is false AND when A is false, which reads the same here and stops
# reading the same the moment a third clause joins (SC2015).
if [ -z "$cand_migrations" ] || [ "$cand_migrations" -le 0 ]; then
    die "found NO migration files in $GRAPPA_IMAGE under lib/grappa-*/priv/repo/migrations — the release layout moved and this probe is now blind"
fi
if [ -z "$prev_migrations" ] || [ "$prev_migrations" -le 0 ]; then
    die "found NO migration files in $GRAPPA_PREVIOUS_IMAGE under lib/grappa-*/priv/repo/migrations — the release layout moved and this probe is now blind"
fi
expected_migrations=$((cand_migrations - prev_migrations))
[ "$expected_migrations" -ge 0 ] \
    || die "$GRAPPA_IMAGE ships FEWER migrations ($cand_migrations) than $GRAPPA_PREVIOUS_IMAGE ($prev_migrations) — a migration was deleted, and the upgrade this probe models cannot be reasoned about"

docker run -d --name "$UP_OLD" -e PHX_HOST=localhost \
    -v "${UP_VOLUME}:/data" "$GRAPPA_PREVIOUS_IMAGE" >/dev/null
wait_healthz "$UP_OLD" "the PREVIOUS release ($GRAPPA_SMOKE_PREVIOUS_VERSION)"

# The control that makes every assertion below mean something: the fixture is
# really the older release. Without it, a resolver that handed back the
# candidate's own ref would turn probe 6 into a second copy of probe 3 and
# report a green upgrade across no seam at all.
old_config="$(docker exec "$UP_OLD" curl -fsS --max-time 20 http://localhost:4000/api/config)" \
    || die "the previous release did not answer /api/config"
grep -Fq "\"version\":\"$GRAPPA_SMOKE_PREVIOUS_VERSION\"" <<<"$old_config" \
    || die "the upgrade fixture does not report $GRAPPA_SMOKE_PREVIOUS_VERSION — this is not the release the candidate is being upgraded FROM: $old_config"

up_env_before="$(docker exec "$UP_OLD" sha256sum /data/grappa.env | cut -d' ' -f1)"
[ -n "$up_env_before" ] || die "no /data/grappa.env after the previous release's first boot"

# The state that must survive, written through the operator door rather than
# poked into the database: an account. Read back after the upgrade by EXIT
# STATUS (a duplicate name is refused), never by matching an error string —
# `Grappa.Release.cli/1` documents the status as the contract, and a message
# is free to be reworded.
printf 'release-smoke-password\n' \
    | docker exec -i "$UP_OLD" bin/grappa create-user "$UP_CARRIER" >/dev/null \
    || die "could not create the carrier account under $GRAPPA_SMOKE_PREVIOUS_VERSION — the upgrade probe has no state to carry across the seam"

# SIGTERM and a real shutdown window, not a kill: the candidate is about to
# open this database, and a half-checkpointed WAL would make any failure below
# a story about the teardown instead of about the upgrade.
docker stop -t 30 "$UP_OLD" >/dev/null

docker run -d --name "$UP_NEW" -e PHX_HOST=localhost \
    -v "${UP_VOLUME}:/data" "$GRAPPA_IMAGE" >/dev/null
wait_healthz "$UP_NEW" "the CANDIDATE ($GRAPPA_SMOKE_VERSION) on the previous release's volume"

up_log="$(docker logs "$UP_NEW" 2>&1)"
# Positive control for the migration assertion, and it comes first: the
# entrypoint says this line before it runs the migrator. Missing, the count
# below would read 0 for "auto-migrate was off" and for "the log moved"
# exactly as it does for "there was nothing to run" — three states, one
# number. Refuse rather than pick.
grep -Fq 'checking for pending migrations' <<<"$up_log" \
    || die "the candidate's boot log never says it checked for pending migrations — GRAPPA_AUTO_MIGRATE is off or the entrypoint changed, and the migration assertion below cannot see anything"
# `|| true` INSIDE the substitution: `grep -c` prints a legitimate 0 and then
# exits 1, and 0 is an answer here, not a failure.
ran_migrations="$(grep -c '== Running ' <<<"$up_log" || true)"
[ "$ran_migrations" -eq "$expected_migrations" ] \
    || die "the upgrade ran $ran_migrations migration(s); $GRAPPA_IMAGE ships $cand_migrations and $GRAPPA_PREVIOUS_IMAGE ships $prev_migrations, so $expected_migrations had to run"

new_config="$(docker exec "$UP_NEW" curl -fsS --max-time 20 http://localhost:4000/api/config)" \
    || die "the candidate did not answer /api/config after the upgrade"
grep -Fq "\"version\":\"$GRAPPA_SMOKE_VERSION\"" <<<"$new_config" \
    || die "after the upgrade the node still does not report $GRAPPA_SMOKE_VERSION: $new_config"

# Probe 3's assertion, across the seam it could not reach. A rotated
# GRAPPA_ENCRYPTION_KEY is silent data loss — every stored credential stops
# decrypting — and an upgrade is exactly when a first-boot bootstrap might
# mistake a populated volume for an empty one.
up_env_after="$(docker exec "$UP_NEW" sha256sum /data/grappa.env | cut -d' ' -f1)"
[ "$up_env_before" = "$up_env_after" ] \
    || die "the UPGRADE rotated /data/grappa.env ($up_env_before -> $up_env_after) — every credential stored under $GRAPPA_SMOKE_PREVIOUS_VERSION is now undecryptable"

# POSITIVE control before the verdict: the account door works on the candidate
# for a name nobody has taken. Without it, a `create-user` broken into always
# failing would make the refusal below look like a surviving row.
printf 'release-smoke-password\n' \
    | docker exec -i "$UP_NEW" bin/grappa create-user "${UP_CARRIER}-fresh" >/dev/null \
    || die "create-user fails on the candidate for a FRESH name — the door is broken, so it cannot be asked whether the old row survived"
if printf 'release-smoke-password\n' \
    | docker exec -i "$UP_NEW" bin/grappa create-user "$UP_CARRIER" >/dev/null 2>&1; then
    die "the candidate created $UP_CARRIER a SECOND time — the account written under $GRAPPA_SMOKE_PREVIOUS_VERSION is gone, so the volume's database did not survive the upgrade"
fi
pass "$GRAPPA_SMOKE_PREVIOUS_VERSION -> $GRAPPA_SMOKE_VERSION: $ran_migrations migration(s) ran, the secrets file held, and the account written under the old release is still there"

# ---- probe 7: nothing the boot created lives OUTSIDE the volume ------------
#
# #1945's second half was silent, not loud. With the old default the peer
# avatars were written to `/app/runtime/peer_avatars` — inside the container
# LAYER, outside `grappa-data` — so a cold update deleted them with no error
# anywhere. A crash at least tells you; this one only shows up as missing data
# later.
#
# `docker diff` is the oracle that fits exactly: it reports the container's
# read-write LAYER and, by construction, never reports what is under a mount.
# So a data root that landed in the volume is invisible here and one that
# missed it is an `A` line. Nothing has to be enumerated in advance, which is
# what makes this a class gate rather than a second list of the three roots
# #1945 happened to fix.
#
# THE BAR IS AN EMPTY DIFF, AND THAT IS A MEASUREMENT, NOT AN IDEAL. On
# ghcr.io/vjt/grappa:v1.5.1 a full boot — entrypoint, secret bootstrap,
# migrator, theme seeder, Phoenix up and answering — leaves the container layer
# with LITERALLY NOTHING in it. There is no release scratch to carve out: no
# /app/tmp, no /tmp, no cookie file. So no allowlist is written here, because
# an allowlist authored ahead of the first entry it needs is a hole with a
# comment on it.
#
# The same reading on the release BEFORE it is the evidence that this probe
# bites. v1.5.0 answers three lines, and two of them are #1945 itself:
#
#     A /app/runtime
#     A /app/runtime/peer_avatars
#     C /app
#
# The next legitimate layer write — should one ever exist — belongs in a human
# decision, not in a pattern widened on the day it first went red.
say "probe 7: the upgraded boot wrote nothing outside /data"
layer="$SMOKE_HOME/upgrade-layer.diff"
docker diff "$UP_NEW" > "$layer" || die "docker diff refused to report $UP_NEW's layer"

if [ -s "$layer" ]; then
    printf '\n----- docker diff %s -----\n' "$UP_NEW" >&2
    cat "$layer" >&2
    die "the boot touched the CONTAINER LAYER, outside the /data volume — a cold update throws that away silently, which is #1945's second half. Measured expectation for a healthy release: no lines at all."
fi

# POSITIVE control, and the ONLY thing standing between the reading above and
# a hollow green: an empty diff is also exactly what a BLIND oracle produces.
# So plant #1945's own path and require `docker diff` to see it. Last, because
# it dirties the container deliberately.
docker exec "$UP_NEW" mkdir -p /app/runtime/peer_avatars \
    || die "could not plant the layer canary — probe 7's own control cannot run"
canary="$SMOKE_HOME/canary-layer.diff"
docker diff "$UP_NEW" > "$canary"
grep -Eq '^A /app/runtime$' "$canary" \
    || die "docker diff does not report a directory just created in $UP_NEW's layer — the oracle is BLIND, and the empty reading above proved nothing"
pass "the boot left the container layer empty, and a planted /app/runtime is still seen"

# ---- probe 8: the candidate boots on hostile substrates --------------------
#
# #1952's class gate. #1945 fixed three storage roots; the next relative
# default lands the same way unless something boots in a shape where the
# process cannot write next to itself. Every probe above runs the image the
# way `docker run` leaves it — WORKDIR /app, writable, as the baked `grappa`
# user — which is the ONE shape in which a relative default silently works.
#
# Each shape below is a real deployment, gets its own fresh volume, and is
# asked exactly one question: does it answer /healthz. The failures they are
# hunting are the same one wearing different clothes — a path resolved against
# something the operator, not the application, chose.
say "probe 8: the candidate boots on hostile substrates"

# The uid:gid the IMAGE gives /data, READ OUT OF THE IMAGE rather than spelled.
# Every shape but the arbitrary-uid one runs as the baked user, so this is the
# ownership their storage must carry — and writing `100:101` here would be a
# second copy of a Dockerfile fact, silently wrong the day `adduser -S` picks
# another number.
IMAGE_DATA_OWNER="$(docker run --rm --entrypoint sh "$GRAPPA_IMAGE" -c 'stat -c "%u:%g" /data')"
[ -n "$IMAGE_DATA_OWNER" ] \
    || die "could not read /data's owner out of $GRAPPA_IMAGE — every shape below would then hand its volume to nobody in particular"

# The arbitrary uid shape 4 runs as. 65534 is `nobody` on every distro and the
# number Kubernetes' own `runAsUser:` examples use, but the POINT is that it is
# not the image's: see the guard on that below.
HOSTILE_UID=65534

# hostile_boot SHAPE ARM-CHECK DATA-OWNER EXTRA-FLAG... — one shape, from a
# fresh volume, asked one question.
#
# ARM-CHECK is a `docker inspect` format string that must come back `true`:
# the proof that the hostile condition is actually IN FORCE. Without it a flag
# that docker silently stopped honouring, or a typo in one, turns this probe
# into a fifth ordinary boot reporting green — the same hollow-green shape
# probe 7's canary exists to refuse, and the reason each shape carries its own
# rather than one shared assertion.
#
# DATA-OWNER is the `uid:gid` the /data volume is handed to before the boot,
# and it is REQUIRED of every shape rather than defaulted, because it is the
# storage contract that shape's operator has to satisfy — stating it is half of
# what the shape means. Three of the four pass the image's own owner, which
# makes the chown a no-op and keeps ONE code path with no branch in it.
#
# WHY A MARKER FILE RIDES WITH THE CHOWN, and it is a measurement about docker
# rather than a trick: docker re-seeds an EMPTY named volume from the image on
# every mount, ownership included. Measured — create a volume, `chown 65534`
# it from a helper, and the NEXT container reads the image's owner back. One
# file inside is enough to make the volume non-empty, and then the ownership
# sticks. The negative control is the shape without it: a virgin volume under
# `--user 65534` dies with `mkdir: can't create directory '/data/uploads':
# Permission denied`. The file is zero bytes, is not grappa state, and is what
# a real arbitrary-uid deployment provides for itself — a Kubernetes `fsGroup`,
# or an operator's `chown` on the host path.
#
# Each shape gets a FIRST boot of its own: one that only works because the
# previous shape already created the state is not the shape an operator meets.
hostile_boot() {
    local shape="$1" arm_check="$2" data_owner="$3"; shift 3
    docker rm -f "$HOSTILE" >/dev/null 2>&1 || true
    docker volume rm "$HOSTILE_VOLUME" >/dev/null 2>&1 || true

    # `--user 0:0` because chown is root's; `--entrypoint sh` because nothing
    # must boot here. The owner arrives as an ARGUMENT, never interpolated into
    # the `-c` string.
    docker run --rm --user 0:0 -v "${HOSTILE_VOLUME}:/data" --entrypoint sh \
        "$GRAPPA_IMAGE" -c 'touch /data/.hostile-fixture && chown -R "$1" /data' \
        sh "$data_owner" >/dev/null \
        || die "the '$shape' substrate: could not hand /data to $data_owner, so the boot below would be testing the wrong storage"

    docker run -d --name "$HOSTILE" -e PHX_HOST=localhost \
        -v "${HOSTILE_VOLUME}:/data" "$@" "$GRAPPA_IMAGE" >/dev/null \
        || die "the '$shape' substrate: docker refused to start the container at all"

    local armed
    armed="$(docker inspect -f "$arm_check" "$HOSTILE")"
    [ "$armed" = true ] \
        || die "the '$shape' substrate was never actually applied — docker reports '$armed' for $arm_check, so whatever this boot proves, it is not that shape"

    wait_healthz "$HOSTILE" "the '$shape' substrate"
    pass "'$shape' is in force and answered /healthz"
    docker rm -f "$HOSTILE" >/dev/null 2>&1 || true
    docker volume rm "$HOSTILE_VOLUME" >/dev/null 2>&1 || true
}

# ── shape 1: a read-only root filesystem ────────────────────────────────────
#
# The hardened-compose shape (`read_only: true`), and the one that states the
# image's contract out loud: /data is the only thing the application writes.
#
# ONE tmpfs, and it is measured rather than assumed. Naked `--read-only` dies
# with `mktemp: : Read-only file system` before it reaches the secret
# bootstrap; `--read-only --tmpfs /tmp` boots. `/app/tmp` is NOT in the recipe
# because the release never writes there — which is the same fact probe 7
# measures from the other side, an empty container layer.
hostile_boot 'read-only rootfs' '{{.HostConfig.ReadonlyRootfs}}' "$IMAGE_DATA_OWNER" \
    --read-only --tmpfs /tmp:rw,mode=1777

# ── shape 2: a working directory the process did not choose ─────────────────
#
# The honest stand-in for the production jail, where #1945 actually happened:
# rc.d starts the release with `su -m grappa` and no `cd` at all, so the cwd is
# `/`. Docker bakes `WORKDIR /app` and makes it writable by the runtime user,
# which is exactly why the same class of defect is SILENT here and FATAL
# there. This shape removes that difference, and one `--workdir` is all it
# takes — the flag a hardened compose file or a Kubernetes `workingDir:` sets
# without a thought.
#
# MEASURED RED before the cure that ships with it: on stock v1.5.1 this exits 1
# with `bin/grappa: not found`, because the entrypoint resolved the release
# RELATIVELY. `infra/docker/release-entrypoint.sh` now takes its directory from
# `$0`, which is a no-op on every path that already worked.
#
# The arm check is `.Config.WorkingDir` and not a `docker exec pwd`: the
# interesting failures here EXIT, and a shape that has to be alive to prove it
# was applied cannot report on the boot that died.
hostile_boot 'cwd the process did not choose (/)' '{{eq .Config.WorkingDir "/"}}' "$IMAGE_DATA_OWNER" \
    --workdir /

# ── shape 3: a volume mounted OVER the release root ─────────────────────────
#
# The release lives at /app, and this shape mounts a named volume there. It is
# not a hypothetical: it is what a Kubernetes PVC pointed one path to the left
# does, and what a compose file that "persists the app" does.
#
# THE SHAPE IS CONSTRUCTIBLE AND IT BOOTS, and that took measuring rather than
# reasoning, because the obvious reading — mounting over /app hides the release,
# so there is nothing left to test — is TRUE OF A BIND MOUNT AND FALSE OF A
# NAMED VOLUME. Docker copies the image's content into an empty named volume at
# first mount (the release, its permissions, the setgid bit on /app), so the
# container comes up; an empty bind mount gets no copy and cannot even be
# created. The non-coverage list at the top of this file carries that second
# reading, since only one of the two has an application in it.
#
# 🔴 A GREEN HERE DOES NOT MEAN THE SHAPE IS SUPPORTED, and the difference is
# measured: the copy-up happens ONCE, while the volume is empty. Pull a new
# image, recreate the container, and the volume still holds the OLD release —
# `docker inspect` reports the new tag and /api/config reports the old version.
# This probe boots on a volume it created seconds earlier, which is the only
# state in which the shape is honest.
#
# WHAT IT ASSERTS BEYOND /healthz, and why it must: `docker diff` — probe 7's
# oracle for "the boot wrote nothing outside /data" — is blind by construction
# under a mount, and reports ZERO LINES for this container even when the boot
# wrote into the release root. Measured on v1.5.0, whose #1945 defect creates
# `runtime/peer_avatars` relative to the cwd: `docker diff` says nothing, and
# the VOLUME grows an eighth entry. So the same property is read through the
# window this shape leaves open — the release root after the boot must be
# exactly the release root the image ships.
hostile_boot 'a volume mounted over the release root (/app)' \
    '{{range .Mounts}}{{if eq .Destination "/app"}}true{{end}}{{end}}' \
    "$IMAGE_DATA_OWNER" \
    -v "${HOSTILE_APP_VOLUME}:/app"

# The container is gone; the /app volume it booted from is not, which is what
# makes this readable at all. `ls -1A` on both sides: hidden entries count,
# since a boot is as free to write `/app/.state` as `/app/runtime`.
app_shipped="$SMOKE_HOME/app-root-shipped.list"
app_after="$SMOKE_HOME/app-root-after-boot.list"
docker run --rm --entrypoint sh "$GRAPPA_IMAGE" -c 'ls -1A /app | sort' > "$app_shipped" \
    || die "could not list the release root the image ships"
docker run --rm -v "${HOSTILE_APP_VOLUME}:/mnt/app" --entrypoint sh "$GRAPPA_IMAGE" \
    -c 'ls -1A /mnt/app | sort' > "$app_after" \
    || die "could not list the release root the '/app volume' boot left behind"

# The anti-hollow-green guard, before the comparison rather than after: two
# empty listings compare EQUAL, and that is exactly what a mount that silently
# resolved nowhere would produce.
[ -s "$app_shipped" ] \
    || die "the image ships an EMPTY /app — the listing is blind and the comparison below cannot fail"

if ! cmp -s "$app_shipped" "$app_after"; then
    printf '\n----- release root: shipped vs after the boot -----\n' >&2
    diff "$app_shipped" "$app_after" >&2 || true
    die "the boot wrote into the RELEASE ROOT, which on this substrate is a mounted volume and therefore invisible to probe 7's docker diff. On v1.5.0 the extra entry was 'runtime', #1945 exactly."
fi

# POSITIVE control, and the only thing between the reading above and a hollow
# green: the same two listings, with #1945's own path planted in the volume.
# `--user 0:0` because the volume root belongs to the image's user, and this
# helper is writing into it from outside.
docker run --rm --user 0:0 -v "${HOSTILE_APP_VOLUME}:/mnt/app" --entrypoint sh \
    "$GRAPPA_IMAGE" -c 'mkdir -p /mnt/app/runtime/peer_avatars' >/dev/null \
    || die "could not plant the release-root canary — shape 3's own control cannot run"
app_canary="$SMOKE_HOME/app-root-canary.list"
docker run --rm -v "${HOSTILE_APP_VOLUME}:/mnt/app" --entrypoint sh "$GRAPPA_IMAGE" \
    -c 'ls -1A /mnt/app | sort' > "$app_canary" \
    || die "could not re-list the release root after planting the canary"
if cmp -s "$app_shipped" "$app_canary"; then
    die "a directory planted in the /app volume does not show up in the listing — the comparison is BLIND, and the equality above proved nothing"
fi
pass "the '/app volume' boot left the release root exactly as the image ships it, and a planted runtime/ is still seen"
docker volume rm "$HOSTILE_APP_VOLUME" >/dev/null 2>&1 || true

# ── shape 4: an arbitrary non-root uid ──────────────────────────────────────
#
# `--user 65534` — a Kubernetes `runAsUser:`, a hardened compose `user:`, an
# OpenShift project that assigns a uid nobody chose. The image bakes its own
# `grappa` user and every other probe here runs as it, so this is the one shape
# that asks whether anything depends on being THAT user rather than merely
# being a user with writable storage.
#
# MEASURED, and it is the strongest red in this file because it is #1945
# verbatim rather than a cousin of it. Identical fixture, identical flags, the
# two releases apart:
#
#   v1.5.1   running/0, /healthz in 2s
#   v1.5.0   exited/1
#            ** (File.Error) could not make directory (with -p)
#               "runtime/peer_avatars": permission denied
#                   (grappa 1.5.0) lib/grappa/avatars/reaper.ex:79
#
# Note the path in that error is RELATIVE. /app is writable by the baked user
# and by nobody else, which is why the same defect is silent on every other
# docker shape and fatal here. The control that makes the pair mean something:
# v1.5.0 on this SAME image with the baked user and an ordinary volume boots
# healthy, so the red belongs to the uid and not to the release.
[ "${HOSTILE_UID}:${HOSTILE_UID}" != "$IMAGE_DATA_OWNER" ] \
    || die "the image's own /data owner IS ${HOSTILE_UID}:${HOSTILE_UID} — this shape would be an ordinary boot wearing a --user flag, and would assert nothing"
hostile_boot "an arbitrary non-root uid (--user ${HOSTILE_UID})" \
    "{{eq .Config.User \"${HOSTILE_UID}:${HOSTILE_UID}\"}}" \
    "${HOSTILE_UID}:${HOSTILE_UID}" \
    --user "${HOSTILE_UID}:${HOSTILE_UID}"

say "release image $GRAPPA_IMAGE deployed and answered every probe 🎉"
