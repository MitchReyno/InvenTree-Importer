#!/bin/sh
# Read-only review refresh. Resolve the checkout, never a developer-specific path.
set -eu
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
git -C "$root" status --short
git -C "$root" branch --show-current
git -C "$root" log -3 --oneline
git -C "$root" diff --stat a4e16686a4c6f563a9dc28aefd94481af5dedf77 -- spikes/durable-coordination backend/tests/spikes/test_durable_coordination.py
