#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
date -u '+%Y-%m-%dT%H:%M:%SZ'
git -C "$root" status --short
git -C "$root" branch --show-current
git -C "$root" log -1 --format='%H %s'
git -C "$root" worktree list
printf '\nOwned probe reports (read-only discovery; never start/reseed these):\n'
find "$root/.temp" "$root/.amp/in/artifacts" -name evidence.json -path '*combined*' -print 2>/dev/null || true
