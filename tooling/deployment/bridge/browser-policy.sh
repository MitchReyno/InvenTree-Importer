#!/bin/bash
# Installs the Chromium seccomp profile that tool workers start under into the guest directory.
set -euo pipefail
vm=${1:?VM name} dir=${2:?private paired directory}
[[ $vm =~ ^[a-z0-9][a-z0-9-]*$ && $dir =~ ^/[a-zA-Z0-9_./-]+$ ]]
guest() { limactl shell --workdir=/ "$vm" sudo "$@"; }
guest test -d "$dir/guest"
guest install -m 0444 /dev/stdin "$dir/browser-seccomp.json.new" < "$(dirname "$0")/../guest/browser-seccomp.json"
guest mv "$dir/browser-seccomp.json.new" "$dir/browser-seccomp.json"
