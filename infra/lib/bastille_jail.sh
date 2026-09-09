# shellcheck shell=sh
# infra/lib/bastille_jail.sh — the m42 production jail's bastille NAME (#2022).
#
# SOURCED, never executed. Strict POSIX sh like its siblings in this
# directory: it is read from inside the jail (/bin/sh) as well as from a
# workstation (bash), so no arrays, no `[[ ]]`, no `local`.
#
# ── The fact ────────────────────────────────────────────────────────
# The jail's NAME is `grappa-new`; `grappa` is its host.hostname. Measured
# on m42 from two independent sources (#2022):
#
#   jls -h jid name host.hostname path
#     11  grappa-new  grappa  /usr/local/bastille/jails/grappa-new/root
#   bastille list
#     11  grappa-new  ...  Up
#
# `bastille cmd`, `bastille restart`, `jexec` and the on-disk jail path all
# take the NAME. Handed the host.hostname instead, they address a jail that
# does not exist — which is what every deploy default said until this file.
# (Spelt out rather than quoted: a wrong spelling written here in argument
# position would trip the gate that reads this very constant.)
#
# ── Why a constant and not a derivation ─────────────────────────────
# The issue suggested deriving the name from `bastille list` / `jls`, on the
# grounds that this is the second name the jail has had. Rejected, for three
# reasons that are about WHERE the name is needed, not about effort:
#
#   1. It is not derivable where it matters most. The sharp edge is the
#      restart hint `infra/freebsd/deploy.sh` prints when the daemon is
#      gone — and that script runs INSIDE the jail. Every `bastille`
#      spelling under infra/freebsd/ is a comment describing the HOST-side
#      invocation; not one of those rails invokes bastille, because bastille
#      is the host's tool for addressing jails from outside. From inside,
#      `hostname` answers `grappa` — the host.hostname, i.e. precisely the
#      wrong token, and precisely the confusion that produced this bug.
#
#   2. Host-side, it only moves the hardcode. To pick this jail out of
#      `bastille list` a script needs a predicate, and the only candidates
#      are the NAME (circular) or the host.hostname `grappa` — reading the
#      Hostname column is the misreading that opened the issue in the first
#      place.
#
#   3. Its failure mode is the one we are curing. A derivation that answers
#      nothing (ssh down, jail stopped) must either die or fall back, and a
#      fallback IS a default that can be silently wrong. Worse, the hint
#      printed when production is down would then depend on a query that is
#      likeliest to fail exactly then.
#
# What actually prevents the drift is that the name is written ONCE for
# every consumer that computes with it, and that
# `test/infra/bastille_jail_name_test.bats` proves every remaining literal
# spelling in the live tree — the usage comments, which cannot source a
# variable — agrees with this value. The next rename is this line plus
# whatever that gate names.
#
# Overridable so a second jail (a staging clone, a rename in flight) can be
# addressed without editing the repo.
BASTILLE_JAIL="${BASTILLE_JAIL:-grappa-new}"
