#!/bin/bash
# Makes sure the host key file and the guest's operator key are the same key. A key is created
# only when neither side has one; a key on one side only, an empty key or two different keys is
# refused, and nothing changes. A failed guest check stops the script before any change.
set -euo pipefail
umask 077
vm=${1:?VM name}
dir=${2:?paired directory inside VM}
key_file=${3:?private operator key file on the host}
[[ $vm =~ ^[a-z0-9][a-z0-9-]*$ && $dir =~ ^/[a-zA-Z0-9_./-]+$ ]]
guest() { limactl shell --workdir=/ "$vm" "$@"; }
guest_key=$dir/operator/key
refuse() {
  echo "vm_operator_key_mismatch: $key_file and $vm:$guest_key" >&2
  exit 3
}
# absent, empty or present; set -e stops on a failed check rather than reading it as absent.
guest_state=$(guest sudo sh -c 'if test ! -e "$1"; then echo absent; elif test -s "$1"; then echo present; else echo empty; fi' sh "$guest_key")
if [[ -e $key_file || -L $key_file ]]; then
  [[ -f $key_file && -s $key_file ]] || refuse
  host_state=present
else
  host_state=absent
fi
if [[ $host_state == present && $guest_state == present ]]; then
  host_hash=$(openssl dgst -sha256 -r < "$key_file" | cut -d' ' -f1)
  guest_hash=$(guest sudo sha256sum "$guest_key" | cut -d' ' -f1)
  [[ $host_hash == "$guest_hash" ]] || refuse
  exit 0
fi
[[ $host_state == absent && $guest_state == absent ]] || refuse
# Neither side has a key: make one, then install it without replacing a key that appeared since.
(set -C; openssl rand -hex 32 > "$key_file")
guest sudo install -d -m 0700 -o 1000 -g 1000 "$dir/operator"
guest sudo sh -c 'set -C; cat > "$1"' sh "$guest_key" < "$key_file"
guest sudo chown 1000:1000 "$guest_key"
guest sudo chmod 0400 "$guest_key"
