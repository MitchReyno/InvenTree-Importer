#!/bin/bash
# Read-only owner state. No auth/token/config reads, inference or inventory calls.
set -eu
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
date -u +'%Y-%m-%dT%H:%M:%SZ'
git -C "$root" branch --show-current
git -C "$root" rev-parse HEAD
git -C "$root" status --short
git -C "$root" log --oneline a4e16686a4c6f563a9dc28aefd94481af5dedf77..HEAD
git -C "$root" worktree list
