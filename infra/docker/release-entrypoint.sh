#!/bin/sh
# release-entrypoint.sh — container entrypoint for the self-contained grappa
# RELEASE image (Dockerfile.release). It caps BEAM resources, bootstraps the
# prod secrets on first boot, migrates, seeds the built-in themes, then execs
# the release.
#
# The caps mirror bin/start.sh's (see its header for the per-user derivation)
# and travel via ERL_ZFLAGS, APPENDED to (never clobbering) any operator value:
#   GRAPPA_MAX_USERS         (default 100) sizes +Q (ports) and +P (procs)
#   GRAPPA_DIRTY_SCHEDULERS  (default max(nproc, 10)) sizes +SDcpu and +SDio
# Why the caps, and why not a baked rel/vm.args:
# docs/OPERATIONS.md § "The Docker deploy driver (infra/docker/)" (#503).

set -e

# THE RELEASE ROOT IS WHERE THIS FILE LIVES, NOT WHERE THE CALLER STOOD (#1952).
#
# Three commands below run `bin/grappa` — the migrator, the theme seeder and
# the final exec — and all three used to spell it RELATIVELY, which resolves
# against a working directory nobody in this script chose. `Dockerfile.release`
# bakes `WORKDIR /app` and this file lands at `/app/release-entrypoint.sh`, so
# on every path that works today `cd` here is a NO-OP: same directory, byte for
# byte the same behaviour. It is the paths that do NOT work today that this is
# for.
#
# MEASURED, on ghcr.io/vjt/grappa:v1.5.1 with `docker run --workdir /`:
#
#     /app/release-entrypoint.sh: line 126: bin/grappa: not found
#     grappa: MIGRATION FAILED — refusing to start.
#     exited/1
#
# One flag — the kind a hardened compose file or a Kubernetes `workingDir:`
# sets without a thought — and the container never comes up. That is issue 1945
# wearing a different hat: a path resolved against a cwd the init system
# chooses rather than the operator, which is exactly how the production jail's
# `su -m grappa` with no `cd` turned an unset storage root into a boot crash.
# The cure there was to stop deriving data paths from the cwd; the cure here is
# to stop deriving the release's OWN path from it.
#
# `$0` is what the kernel was told to execute — `/app/release-entrypoint.sh`
# from the image's ENTRYPOINT, or `<release>/bin/../release-entrypoint.sh` when
# `infra/release/grappa.sh` re-enters this script for a docker-exec'd account
# verb (#1683). `dirname` of either lands on the release root; `cd` resolves the
# `..` on the way. The BEAM inherits that cwd, so a relative default anywhere
# downstream resolves where it always did instead of wherever the operator's
# shell happened to be.
cd "$(dirname "$0")"

# …and having chosen the directory, SAY SO IF THE RELEASE IS NOT IN IT (#1952).
#
# Three commands below run `bin/grappa`; the first of them is the migrator, and
# what the script used to say when that command could not be executed was
# `MIGRATION FAILED — refusing to start`, followed by a paragraph about rolling
# the schema back. Measured under `docker run --workdir /`: the operator is
# told the database broke while nothing had opened it. CLAUDE.md's log-honesty
# rule is exactly this — a fast path states what it OBSERVED, not the work it
# did not do.
#
# A PRECONDITION and not an exit-status arm, because the status is not a fact
# about the fault. Measured on one missing file: `sh -c 'bin/nothere'` answers
# 127 from an interactive-style invocation, the image's busybox ash prints
# `not found`, and this script's own `if ! bin/grappa …` under `set -e` on
# bash-as-sh hands back **1** — indistinguishable from a migration that ran and
# failed. `test -x` asks the question directly and answers it the same way on
# every shell.
#
# One check, at the top, for all three call sites: a release tree with no
# runnable `bin/grappa` cannot migrate, cannot seed and cannot boot, so there
# is nothing further worth attempting and no verb worth excepting.
if [ ! -x bin/grappa ]; then
    echo "grappa: no runnable bin/grappa under $(pwd) — this release tree is broken." >&2
    echo "grappa: NOTHING has been migrated and the database is untouched." >&2
    exit 1
fi

: "${GRAPPA_MAX_USERS:=100}"
default_schedulers="$(nproc)"
if [ "$default_schedulers" -lt 10 ]; then
    default_schedulers=10
fi
: "${GRAPPA_DIRTY_SCHEDULERS:=$default_schedulers}"

GRAPPA_MAX_PORTS=$((GRAPPA_MAX_USERS * 400))
GRAPPA_MAX_PROCS=$((GRAPPA_MAX_USERS * 100))

ERL_ZFLAGS="${ERL_ZFLAGS:+$ERL_ZFLAGS }+Q ${GRAPPA_MAX_PORTS} +P ${GRAPPA_MAX_PROCS} +SDcpu ${GRAPPA_DIRTY_SCHEDULERS} +SDio ${GRAPPA_DIRTY_SCHEDULERS}"
export ERL_ZFLAGS

# The sqlite DB parent + the two data roots must exist and be writable before
# boot — exqlite opens but does NOT create the parent dir. A root-owned bind
# mount is the operator's to chown; failing loud here beats a cryptic "unable
# to open database file" at first write.
#
# The peer-avatar root joined this list with #1945: its fallback mirrors the
# one config/runtime.exs derives (the sibling of the database), so the shell
# and the BEAM cannot disagree about where the third root is when the var is
# unset.
data_dir="$(dirname "${DATABASE_PATH:-/data/grappa.db}")"
mkdir -p "$data_dir" \
    "${UPLOADS_STORAGE_ROOT:-/data/uploads}" \
    "${PEER_AVATARS_STORAGE_ROOT:-$data_dir/peer_avatars}"

# ── First-boot secret bootstrap (#862) ──────────────────────────────────────
#
# Fill the secrets that are absent (or empty) in the container env from a file
# on the /data volume, generated by the same infra/packaging/gen-secrets.sh the
# .deb/.rpm hosts run. Three rules:
#
#   1. OPERATOR ENV WINS — a var already in the env is never read from the
#      file, and a fully-populated env generates nothing and touches no file.
#   2. NEVER ROTATE — the generator only fills blanks and a restart MUST reuse
#      the file byte-for-byte.
#   3. PHX_HOST IS NOT INVENTABLE — it stays the operator's, so a bare run
#      still fails on that one variable.
# Why: docs/OPERATIONS.md § "The Docker deploy driver (infra/docker/)" (#862).
#
# Values are line-parsed and exported individually, never `.`-sourced: sourcing
# would execute the file's contents and would also clobber operator env.
secrets_file="${data_dir}/grappa.env"
missing=''
for key in SECRET_KEY_BASE SECRET_SIGNING_SALT RELEASE_COOKIE \
           GRAPPA_ENCRYPTION_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
    eval "current=\${${key}:-}"
    [ -n "$current" ] || missing="${missing}${key} "
done

if [ -n "$missing" ]; then
    # umask BEFORE the create: the file must never be world-readable, not even
    # for the instant between create and chmod.
    umask 077
    if [ ! -f "$secrets_file" ]; then
        : > "$secrets_file" || {
            echo "grappa: cannot create $secrets_file — is /data writable by this container?" >&2
            exit 1
        }
    fi

    # gen-secrets.sh ships beside this script in /app, and runs under bash (not
    # the busybox ash running this file): it relies on `set -o pipefail`.
    GRAPPA_ENV_FILE="$secrets_file" GRAPPA_ENV_MODE=0600 \
        bash "$(dirname "$0")/gen-secrets.sh" >&2

    for key in $missing; do
        value="$(sed -n "s/^${key}=//p" "$secrets_file" | tail -1)"
        [ -n "$value" ] || {
            echo "grappa: $secrets_file has no value for $key after bootstrap" >&2
            exit 1
        }
        export "$key=$value"
    done

    echo "grappa: bootstrapped ${missing}from $secrets_file — back that file up," \
         "GRAPPA_ENCRYPTION_KEY decrypts every stored upstream credential" >&2
fi

# ── Boot-time migration (#867) ──────────────────────────────────────────────
#
# ON by default: a bare `docker run` of this image has no other door to the
# migrator. GRAPPA_AUTO_MIGRATE=0 is the door out, and deploy.sh passes exactly
# that — it migrates from the host instead. Unknown values are rejected, never
# guessed as off.
# Why: docs/OPERATIONS.md § "The Docker deploy driver (infra/docker/)" (#867).
auto_migrate="${GRAPPA_AUTO_MIGRATE:-1}"
case "$auto_migrate" in
    0 | 1) ;;
    *)
        echo "grappa: GRAPPA_AUTO_MIGRATE must be 0 or 1, got '$auto_migrate'" >&2
        exit 1
        ;;
esac

# Only the verbs that BOOT the release. `eval` / `rpc` / `remote` / `stop` /
# `version` must never trigger it: deploy.sh's own migrate runs through this
# very entrypoint, and a nested migrate would be a second BEAM racing the first.
boots_the_release=0
case "${1:-}" in
    start | start_iex | daemon | daemon_iex) boots_the_release=1 ;;
esac

if [ "$auto_migrate" = 1 ] && [ "$boots_the_release" = 1 ]; then
    # "checking", not "applying": an up-to-date DB applies nothing.
    echo "grappa: checking for pending migrations (GRAPPA_AUTO_MIGRATE=0 to manage the schema yourself)" >&2

    # NOT `$(...)` in argument position: a failure there does not stop the
    # script (#441). The `if !` reads the real exit status.
    if ! bin/grappa eval 'Grappa.Release.migrate()'; then
        echo "grappa: MIGRATION FAILED — refusing to start." >&2
        echo "grappa: nothing was dropped; Ecto runs each migration in its own" \
             "transaction, so the database is readable and schema_migrations" \
             "records exactly what applied. Fix the cause and restart, or roll" \
             "back with: docker run --rm -v <volume>:/data <image> eval" \
             "'Grappa.Release.rollback(Grappa.Repo, <version>)'" >&2
        exit 1
    fi

    # ── Built-in theme gallery (#1167) ─────────────────────────────────
    # Same argument as the migration above: the palettes are compiled into
    # this image and their wallpapers ride the cic bundle, but the gallery
    # reads the DB and a bare `docker run` has no other door to the seeder.
    # It rides GRAPPA_AUTO_MIGRATE rather than taking a knob of its own —
    # an operator who sets that to 0 did so to keep boot from writing to
    # the database, and seeding is a write.
    # NON-FATAL, unlike the migration: a half-applied schema is a
    # correctness defect, an empty gallery is cosmetic and the idempotent
    # upsert converges on the next boot. Refusing to start here would
    # trade a working bouncer for a missing colour scheme (the posture
    # deploy_common has held on every substrate since #440).
    if ! bin/grappa eval 'Grappa.Release.seed_themes()'; then
        echo "grappa: built-in theme seeding FAILED — starting anyway." >&2
        echo "grappa: the schema is applied and the bouncer is usable; the" \
             "theme gallery may be empty or stale. The upsert converges, so" \
             "the next boot heals it. Retry now with: docker run --rm" \
             "-v <volume>:/data <image> eval 'Grappa.Release.seed_themes()'" >&2
    fi
fi

exec bin/grappa "$@"
