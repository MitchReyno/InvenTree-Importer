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
if [[ ! -e $key_file ]]; then (set -C; openssl rand -hex 32 > "$key_file"); fi
guest sudo install -d -m 0700 -o 1000 -g 1000 "$dir/operator" "$dir/claude-store" "$dir/egress"
guest sudo install -m 0400 -o 1000 -g 1000 /dev/stdin "$dir/operator/key" < "$key_file"
base=(--detach --restart=unless-stopped --read-only --tmpfs=/tmp:rw,nosuid,nodev,size=16m --cap-drop=ALL --security-opt=no-new-privileges --user=1000:1000 --pids-limit=48)
guest sudo docker run "${base[@]}" --memory=128m --name bench-claude-egress \
  --mount "type=bind,src=$dir/egress,dst=/run/egress" "$image" python3 /opt/guest-tools/claude-egress.py
# The management service settles near 150 MiB, so it gets the same cap as the Codex one.
guest sudo docker run "${base[@]}" --memory=384m --name bench-claude-management -p 127.0.0.1:14315:14315 \
  -e "INTAKE_OPERATOR_ORIGIN=$origin" --mount "type=bind,src=$dir/operator,dst=/run/operator,readonly" \
  --mount "type=bind,src=$dir/claude-store,dst=/run/claude-store" \
  "$image" node --import tsx src/agents/shared-vm/credential-main.ts
