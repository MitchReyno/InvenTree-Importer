#!/bin/sh
# Emit a portable record of the images actually available to the two engines.
set -eu
vm=${1:?dedicated Lima VM name}
app=${2:?host app image}
runner=${3:?guest runner image}
case "$vm" in -*|*[!a-z0-9-]*) exit 2 ;; esac
format='{{.Os}}/{{.Architecture}} {{.Id}}'
host=$(docker image inspect --format "$format" -- "$app")
guest=$(limactl shell --workdir=/ "$vm" sudo docker image inspect --format "$format" -- "$runner")
for identity in "$host" "$guest"; do
  case "$identity" in *'
'*) exit 1 ;; esac
  if ! printf '%s\n' "$identity" | LC_ALL=C grep -Eq '^linux/arm64 sha256:[a-f0-9]{64}$'; then
    echo 'Expected one Linux ARM64 image with a full Docker image ID.' >&2
    exit 1
  fi
done
printf 'app %s\nrunner %s\n' "$host" "$guest"
