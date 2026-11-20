#!/bin/bash
# Makes sure the host key file and the guest's operator key are the same key. A key is created
# only when neither side has one; one side only, or different keys, is refused and nothing changes.
set -euo pipefail
umask 077
vm=${1:?VM name}
dir=${2:?paired directory inside VM}
key_file=${3:?private operator key file on the host}
[[ $vm =~ ^[a-z0-9][a-z0-9-]*$ && $dir =~ ^/[a-zA-Z0-9_./-]+$ ]]
guest() { limactl shell --workdir=/ "$vm" "$@"; }
refuse() {
  echo "vm_operator_key_mismatch: $key_file and $vm:$dir/operator/key" >&2
  exit 3
}
if guest sudo test -s "$dir/operator/key"; then
  [[ -s $key_file ]] || refuse
  host_hash=$(openssl dgst -sha256 -r < "$key_file" | cut -d' ' -f1)
  guest_hash=$(guest sudo sha256sum "$dir/operator/key" | cut -d' ' -f1)
  [[ $host_hash == "$guest_hash" ]] || refuse
  exit 0
fi
# The guest has no key: the host file must be one this run may install, made now if missing.
if [[ ! -e $key_file ]]; then (set -C; openssl rand -hex 32 > "$key_file"); fi
[[ -s $key_file ]] || refuse
guest sudo install -d -m 0700 -o 1000 -g 1000 "$dir/operator"
guest sudo install -m 0400 -o 1000 -g 1000 /dev/stdin "$dir/operator/key" < "$key_file"
