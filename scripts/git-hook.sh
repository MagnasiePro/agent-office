#!/bin/sh
# Agent Office global git hook, installed by scripts/git-hooks.mjs next to (never instead of) repo hooks.
#   sh git-hook.sh <port> pre-push [remote url]   marks that a push is in flight
#   sh git-hook.sh <port> refs <state>            on a committed remote-tracking update, POSTs push or pull
# Always exits 0 and never waits on the network: a non-zero exit would abort the user's push or ref update.
port=$1
kind=$2

common=$(git rev-parse --git-common-dir 2>/dev/null)
# Absolute, so every worktree of a repo shares one marker.
common=$(cd "${common:-.}" 2>/dev/null && pwd -P)
m="${TMPDIR:-/tmp}/agent-office-push-$(printf %s "$common" | cksum | cut -d' ' -f1)"

if [ "$kind" = pre-push ]; then
  touch "$m" 2>/dev/null
  cat >/dev/null
  exit 0
fi

lines=$(cat)
[ "$kind" = refs ] && [ "$3" = committed ] || exit 0
# Only a remote-tracking ref moved to a commit counts: not a symref (origin/HEAD) nor a prune (all-zero new id).
printf '%s\n' "$lines" | grep -q '^[^ ]* [0-9a-f]*[1-9a-f][0-9a-f]* refs/remotes/' || exit 0

direction=pull
[ -n "$(find "$m" -mmin -2 2>/dev/null)" ] && direction=push
rm -f "$m"

repo=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$repo" ] || exit 0
repo=$(printf %s "$repo" | sed 's/\\/\\\\/g; s/"/\\"/g')
json="{\"repo\":\"$repo\",\"direction\":\"$direction\"}"
curl -s -m 0.5 -o /dev/null -X POST "http://localhost:$port/git" -H 'content-type: application/json' --data-binary "$json" >/dev/null 2>&1 &
exit 0
