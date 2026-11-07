#!/bin/bash
# Read-only task snapshot. Resolve the checkout at runtime; never edit authority.
set -eu
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
date -u '+snapshot %Y-%m-%d %H:%M:%S UTC'
git -C "$ROOT" status --short
git -C "$ROOT" branch --show-current
git -C "$ROOT" log -3 --oneline
git -C "$ROOT" worktree list
git -C "$ROOT" diff --stat a4e16686a4c6f563a9dc28aefd94481af5dedf77
printf '\nPublication: owner has not opened a PR or pushed; coordinator owns publication.\n'
