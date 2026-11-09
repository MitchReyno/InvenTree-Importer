#!/bin/bash
set -euo pipefail
vm=${1:?VM name} dir=${2:?private paired directory} image=${3:?tool runner image}
[[ $vm =~ ^[a-z0-9-]+$ && $dir =~ ^/[a-zA-Z0-9_./-]+$ && $image =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$ ]]
guest() { limactl shell --workdir=/ "$vm" sudo "$@"; }
guest test -d "$dir/guest"
guest install -m 0444 /dev/stdin "$dir/browser-seccomp.json.new" < "$(dirname "$0")/../guest/browser-seccomp.json"
guest mv "$dir/browser-seccomp.json.new" "$dir/browser-seccomp.json"
guest install -d -m 0700 -o 1000 -g 1000 "$dir/web"
# Publish the reader and provider destination policy together. A fresh deployment directory
# has no tool-worker policy until the reader has bound its Unix socket.
guest docker run -d --restart=unless-stopped --name bench-public-reader --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --user=1000:1000 --pids-limit=24 --memory=96m \
  --env "INTAKE_VM_WEB_MODE=${INTAKE_VM_WEB_MODE:-listed}" \
  --env "INTAKE_VM_WEB_ORIGINS=${INTAKE_VM_WEB_ORIGINS:-}" \
  --env "INTAKE_VM_PROTECTED_HOSTS=${INTAKE_VM_PROTECTED_HOSTS:-}" \
  --volume "$dir/web:/run/web" "$image" python3 /opt/guest-tools/web-reader.py

for i in {1..40}; do
  if guest docker exec bench-public-reader python3 -c 'import socket; s=socket.socket(socket.AF_UNIX); s.connect("/run/web/reader.sock"); s.close()' 2>/dev/null; then
    break
  fi
  if [[ $i = 40 ]]; then exit 1; fi
  sleep .1
done
printf '%s\n' "${INTAKE_VM_PROTECTED_HOSTS:-}" | guest install -m 0444 /dev/stdin "$dir/tool-protected-hosts.new"
guest mv "$dir/tool-protected-hosts.new" "$dir/tool-protected-hosts"
