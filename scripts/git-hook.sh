#!/bin/sh
# Agent Office global git hook, installed by scripts/git-hooks.mjs next to (never instead of) repo hooks.
#   sh git-hook.sh <port> pre-push <remote> <url>   records which tracking refs the push will move, and to what
#   sh git-hook.sh <port> refs <state>              on a committed remote-tracking update, POSTs push or pull
# Always exits 0 and never waits on the network: a non-zero exit would abort the user's push or ref update.
port=$1
kind=$2

common=$(git rev-parse --git-common-dir 2>/dev/null)
# Absolute, so every worktree of a repo shares one marker.
common=$(cd "${common:-.}" 2>/dev/null && pwd -P)
m="${TMPDIR:-/tmp}/agent-office-push-$(printf %s "$common" | cksum | cut -d' ' -f1)"

if [ "$kind" = pre-push ]; then
  # Marker: epoch time, then one "refs/remotes/<remote>/<branch> <sha>" line per branch pushed (deletions skipped).
  {
    date +%s
    while read -r _ lsha rref _; do
      case $lsha in *[1-9a-f]*) ;; *) continue ;; esac
      case $rref in refs/heads/*) echo "refs/remotes/$3/${rref#refs/heads/} $lsha" ;; esac
    done
  } >"$m" 2>/dev/null
  cat >/dev/null
  exit 0
fi

lines=$(cat)
[ "$kind" = refs ] && [ "$3" = committed ] || exit 0
# Only a remote-tracking ref moved to a commit counts: not a symref (origin/HEAD) nor a prune (all-zero new id).
moved=$(printf '%s\n' "$lines" | grep '^[^ ]* [0-9a-f]*[1-9a-f][0-9a-f]* refs/remotes/' | cut -d' ' -f2,3)
[ -n "$moved" ] || exit 0
repo=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$repo" ] || exit 0
repo=$(printf %s "$repo" | sed 's/\\/\\\\/g; s/"/\\"/g')
post() {
  curl -s -m 0.5 -o /dev/null -X POST "http://localhost:$port/git" -H 'content-type: application/json' \
    --data-binary "{\"repo\":\"$repo\",\"direction\":\"$1\"}" >/dev/null 2>&1 &
}

t=$(head -n 1 "$m" 2>/dev/null)
case $t in '' | *[!0-9]*) t=0 ;; esac
[ $(($(date +%s) - t)) -lt 120 ] || rm -f "$m"
push= pull=
while read -r sha ref; do
  if [ -f "$m" ] && grep -qxF "$ref $sha" "$m"; then
    grep -vxF "$ref $sha" "$m" >"$m.tmp"; mv -f "$m.tmp" "$m"; push=1
  else
    pull=1
  fi
done <<EOF
$moved
EOF
# A push moves each tracking ref in its own transaction: one POST per marker, marker gone once all refs are seen.
if [ -n "$push" ] && ! grep -qx sent "$m"; then post push; echo sent >>"$m"; fi
[ -f "$m" ] && ! grep -q ' ' "$m" && rm -f "$m"
[ -n "$pull" ] && post pull
exit 0
