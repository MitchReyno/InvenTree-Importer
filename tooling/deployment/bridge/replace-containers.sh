#!/bin/bash
# Removes the named guest containers so a provisioning script can recreate them, but only when each
# existing one mounts nothing outside this installation's directory. A container that belongs to
# another installation stops the script before anything is removed.
set -euo pipefail
vm=${1:?VM name}
dir=${2:?paired directory inside VM}
shift 2
[[ $vm =~ ^[a-z0-9][a-z0-9-]*$ && $dir =~ ^/[a-zA-Z0-9_./-]+$ && $# -gt 0 ]]
guest() { limactl shell --workdir=/ "$vm" "$@"; }
existing=()
for name in "$@"; do
  if ! mounts=$(guest sudo docker inspect --format '{{range .Mounts}}{{.Source}} {{end}}' "$name" 2>/dev/null); then
    continue
  fi
  for source in $mounts; do
    if [[ $source != "$dir/"* ]]; then
      echo "vm_guest_service_conflict: $name" >&2
      exit 4
    fi
  done
  existing+=("$name")
done
if (( ${#existing[@]} > 0 )); then
  guest sudo docker rm -f "${existing[@]}" >/dev/null
fi
