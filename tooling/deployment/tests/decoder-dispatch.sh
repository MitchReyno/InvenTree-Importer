#!/bin/sh
# Run against a dedicated qualification engine with the three named images loaded.
set -eu
app=${1:?app image} dispatcher=${2:?dispatcher image} decoder=${3:?decoder image}
digest=$(docker image inspect --format '{{.Id}}' -- "$decoder")
previous_app=${4:-}
previous_dispatcher=${5:-}
if [ -n "$previous_app" ] || [ -n "$previous_dispatcher" ]; then
  : "${previous_app:?previous app required}" "${previous_dispatcher:?previous dispatcher required}"
fi
state=$(mktemp -d)
name=bench-dispatcher-${state##*.}
ipc=$name-ipc
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$ipc" >/dev/null 2>&1 || true
  rmdir "$state"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP
docker volume create "$ipc" >/dev/null
start_dispatcher() {
docker run -d --name "$name" --network=none --read-only --tmpfs /tmp \
  --cap-drop=ALL --security-opt=no-new-privileges --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v /var/run/docker.sock:/var/run/docker.sock -v "$ipc:/run/decoder" \
  -e "INTAKE_MEDIA_DECODER_IMAGE=$digest" "$1" >/dev/null
i=0
until docker exec "$name" test -S /run/decoder/worker.sock; do
  i=$((i+1))
  [ "$i" -lt 30 ] || { docker logs "$name"; exit 1; }
  sleep 1
done
}

stop_dispatcher() {
  docker stop --timeout 70 "$name" >/dev/null
  docker rm "$name" >/dev/null
}

check_client() {
docker run --rm -i --network=none --read-only --tmpfs /tmp --cap-drop=ALL \
  --security-opt=no-new-privileges -v "$ipc:/run/decoder:ro" \
  -e INTAKE_MEDIA_DISPATCH_SOCKET=/run/decoder/worker.sock -e "INTAKE_MEDIA_DECODER_IMAGE=$digest" \
  -e "SMOKE_MODE=$2" "$1" node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { decodeIsolated } from './src/media/decoder-runner.ts'
assert.equal(existsSync('/var/run/docker.sock'), false)
const bytes = await sharp({create:{width:16,height:12,channels:3,background:'red'}}).png().toBuffer()
const input = {version:'media-decode/1',digest:createHash('sha256').update(bytes).digest('hex'),bytes}
await assert.rejects(decodeIsolated('sha256:'+'0'.repeat(64),input),/decoder_dispatch_refused/)
const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
const decode = () => decodeIsolated(image,input)
let result
if (process.env.SMOKE_MODE === 'reserve') {
  const {withDecoderAdmission} = await import('./src/media/decoder-admission.ts')
  result = await withDecoderAdmission(image,'decode',null,decode)
} else {
  result = await decode()
}
assert.equal(result.state,'ready')
assert.equal(result.pages[0].width,16)
assert.equal(result.pages[0].height,12)
console.log('Decoded a synthetic image through the fixed dispatcher. Wrong image selection was refused.')
JS
}

if [ -n "$previous_app" ]; then
  start_dispatcher "$previous_dispatcher"
  check_client "$previous_app" legacy
  stop_dispatcher
fi
start_dispatcher "$dispatcher"
if [ -n "$previous_app" ]; then check_client "$previous_app" legacy; fi
check_client "$app" reserve
if [ -n "$previous_app" ]; then
  check_client "$previous_app" legacy
  stop_dispatcher
  start_dispatcher "$previous_dispatcher"
  check_client "$previous_app" legacy
fi
stop_dispatcher
