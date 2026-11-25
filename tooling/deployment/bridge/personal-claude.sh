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
bash "$(dirname "$0")/replace-containers.sh" "$vm" "$dir" bench-claude-egress bench-claude-management bench-claude-catalog
base=(--detach --restart=unless-stopped --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=1000:1000)
guest sudo docker run "${base[@]}" --tmpfs=/tmp:rw,nosuid,nodev,size=16m --pids-limit=48 --memory=128m --name bench-claude-egress \
  --mount "type=bind,src=$dir/egress,dst=/run/egress" "$image" python3 /opt/guest-tools/guest-egress.py
# The guest pairing identity authenticates its private status-only endpoint to the coordinator.
# The management service settles near 150 MiB, so it gets the same cap as the Codex one.
guest sudo docker run "${base[@]}" --tmpfs=/tmp:rw,nosuid,nodev,size=16m --pids-limit=48 --memory=384m \
  --name bench-claude-management -p 127.0.0.1:14315:14315 \
  -e "INTAKE_OPERATOR_ORIGIN=$origin" --mount "type=bind,src=$dir/operator,dst=/run/operator,readonly" \
  --mount "type=bind,src=$dir/guest,dst=/run/bench-pair,readonly" \
  --mount "type=bind,src=$dir/claude-store,dst=/run/claude-store" \
  "$image" node --import tsx src/agents/shared-vm/credential-main.ts
# The model catalogue starts the pinned Claude CLI with the saved token, so like a turn it has no
# network: only the Anthropic-only egress socket. It reads the store, never writes it, and its
# pairing identity authenticates the catalogue endpoint. It has room for the CLI, as a turn has.
guest sudo docker run "${base[@]}" --network=none --tmpfs=/tmp:rw,nosuid,nodev,size=64m --pids-limit=128 \
  --memory=512m --name bench-claude-catalog \
  --mount "type=bind,src=$dir/guest,dst=/run/bench-pair,readonly" \
  --mount "type=bind,src=$dir/egress,dst=/run/egress,readonly" \
  --mount "type=bind,src=$dir/claude-store,dst=/run/claude-store,readonly" \
  "$image" node --import tsx src/agents/shared-vm/catalog-main.ts
