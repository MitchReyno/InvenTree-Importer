#!/bin/bash
# Pair one personal installation. Both destination directories must be new.
set -euo pipefail
umask 077
vm=${1:?provide the Lima instance name}
host_dir=${2:?provide a new private directory for the coordinator identity}
guest_dir=${3:?provide a new private directory inside the guest}
[[ "$vm" =~ ^[a-z0-9][a-z0-9-]*$ && "$host_dir" = /* && "$guest_dir" =~ ^/[a-zA-Z0-9_./-]+$ ]]
mkdir -m 700 "$host_dir"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cd "$stage"
mkdir guest host
openssl req -x509 -newkey rsa:2048 -nodes -subj '/CN=Bench Intake pairing CA' -days 365 \
  -keyout ca.key -out ca.pem >/dev/null 2>&1
for role in host guest; do
  name=bench-guest
  [[ "$role" != host ]] || name=bench-coordinator
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$name" -keyout "$role/key.pem" -out "$role.csr" >/dev/null 2>&1
  printf 'subjectAltName=DNS:%s\n' "$name" > ext
  openssl x509 -req -in "$role.csr" -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 \
    -extfile ext -out "$role/cert.pem" >/dev/null 2>&1
  cp ca.pem "$role"
done
limactl shell --workdir=/ "$vm" mkdir -m 700 "$guest_dir"
COPYFILE_DISABLE=1 tar cf - guest | limactl shell --workdir=/ "$vm" tar xf - -C "$guest_dir"
limactl shell --workdir=/ "$vm" sudo chown -R 1000:1000 "$guest_dir/guest"
limactl shell --workdir=/ "$vm" sudo install -d -o 1000 -g 1000 -m 700 "$guest_dir/sessions"
cp host/*.pem "$host_dir/"
