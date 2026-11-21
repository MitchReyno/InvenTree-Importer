#!/bin/bash
# Reuse the paired operator identity, with a separate guest home and egress socket.
set -euo pipefail
vm=${1:?VM name}
dir=${2:?private paired directory}
image=${3:?personal runner image}
origin=${4:?exact browser origin}
[[ $vm =~ ^[a-z0-9][a-z0-9-]*$ && $dir =~ ^/[a-zA-Z0-9_./-]+$ && $image =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$ ]]
guest() { limactl shell --workdir=/ "$vm" "$@"; }
key_file=${5:?private operator key file on the host}
guest test -d "$dir/guest"
# Never makes a key while the guest has one, or replaces the guest's key.
bash "$(dirname "$0")/operator-key.sh" "$vm" "$dir" "$key_file"
guest sudo install -d -m 0700 -o 1000 -g 1000 "$dir/codex-state" "$dir/codex-egress"
# Replaces only this provider's containers, and only when they belong to this installation; the state, egress and key directories stay.
bash "$(dirname "$0")/replace-containers.sh" "$vm" "$dir" bench-codex-egress bench-codex-management
base=(--detach --restart=unless-stopped --read-only --tmpfs=/tmp:rw,nosuid,nodev,size=48m --cap-drop=ALL --security-opt=no-new-privileges --user=1000:1000 --pids-limit=100 --memory=384m -e INTAKE_VM_CODEX_SUBSCRIPTION=1)
guest sudo docker run "${base[@]}" --name bench-codex-egress \
  --mount "type=bind,src=$dir/codex-egress,dst=/run/egress" "$image" python3 /opt/guest-tools/guest-egress.py
guest sudo docker run "${base[@]}" --name bench-codex-management -p 127.0.0.1:14317:14317 \
  -e "INTAKE_OPERATOR_ORIGIN=$origin" --mount "type=bind,src=$dir/operator,dst=/run/operator,readonly" \
  --mount "type=bind,src=$dir/codex-egress,dst=/run/egress,readonly" \
  --mount "type=bind,src=$dir/codex-state,dst=/run/codex-state" \
  "$image" node --import tsx src/agents/shared-vm/credential-main.ts
