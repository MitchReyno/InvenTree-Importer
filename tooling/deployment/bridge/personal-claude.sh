#!/bin/bash
# Run after pair.sh. The operator key stays outside the provider's mount namespace.
set -euo pipefail
umask 077
vm=${1:?VM name}
dir=${2:?paired directory inside VM}
image=${3:?personal runner image}
key_file=${4:?private operator key file on the host}
origin=${5:?exact browser origin}
[[ $vm =~ ^[a-z0-9][a-z0-9-]*$ && $dir =~ ^/[a-zA-Z0-9_./-]+$ && $image =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$ ]]
guest() { limactl shell --workdir=/ "$vm" "$@"; }
guest test -d "$dir/guest"
# Never makes a key while the guest has one, or replaces the guest's key.
bash "$(dirname "$0")/operator-key.sh" "$vm" "$dir" "$key_file"
guest sudo install -d -m 0700 -o 1000 -g 1000 "$dir/claude-store" "$dir/egress"
# Replaces only this provider's containers, and only when they belong to this installation; the store, egress and key directories stay.
bash "$(dirname "$0")/replace-containers.sh" "$vm" "$dir" bench-claude-egress bench-claude-management
base=(--detach --restart=unless-stopped --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=1000:1000)
guest sudo docker run "${base[@]}" --tmpfs=/tmp:rw,nosuid,nodev,size=16m --pids-limit=48 --memory=128m --name bench-claude-egress \
  --mount "type=bind,src=$dir/egress,dst=/run/egress" "$image" python3 /opt/guest-tools/guest-egress.py
# The guest pairing identity authenticates its private status and model catalogue endpoints to the
# coordinator. A catalogue read starts the pinned Claude CLI here, with a home in /tmp and the
# Anthropic-only egress a turn uses, so the service gets room for that process beside its own
# 150 MiB, as a turn container has.
guest sudo docker run "${base[@]}" --tmpfs=/tmp:rw,nosuid,nodev,size=64m --pids-limit=128 --memory=768m \
  --name bench-claude-management -p 127.0.0.1:14315:14315 \
  -e "INTAKE_OPERATOR_ORIGIN=$origin" --mount "type=bind,src=$dir/operator,dst=/run/operator,readonly" \
  --mount "type=bind,src=$dir/guest,dst=/run/bench-pair,readonly" \
  --mount "type=bind,src=$dir/egress,dst=/run/egress,readonly" \
  --mount "type=bind,src=$dir/claude-store,dst=/run/claude-store" \
  "$image" node --import tsx src/agents/shared-vm/credential-main.ts
