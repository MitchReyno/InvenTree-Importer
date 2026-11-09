#!/bin/bash
# The optional third argument runs the trusted app in host Docker.
set -euo pipefail
umask 077
vm=${1:?provide the dedicated qualification VM name}
image=${2:?provide the guest-loaded app image}
app_image=${3:-}
root=$(cd "$(dirname "$0")/../../../.." && pwd)
state=$(mktemp -d)
id=$(openssl rand -hex 8)
remote="/tmp/bench-pair-$id"
db="bench-dispatch-$id"
app="bench-coordinator-$id"
relay=''
cleanup() {
  if [[ -n "$relay" ]]; then kill "$relay" 2>/dev/null || true; fi
  if [[ -n "$app_image" ]]; then docker rm -f "$app" >/dev/null 2>&1 || true; fi
  docker rm -f "$db" >/dev/null 2>&1 || true
  limactl shell --workdir=/ "$vm" sudo rm -rf "$remote" >/dev/null
  rm -rf "$state"
}
trap cleanup EXIT
cd "$state"
"$root/tooling/deployment/bridge/pair.sh" "$vm" "$state/host" "$remote"
pw=$(openssl rand -hex 32)
if [[ -n "$app_image" ]]; then
  network=(--network=none)
else
  network=(-p 127.0.0.1::5432)
fi
docker run -d --rm --name "$db" "${network[@]}" -e POSTGRES_PASSWORD="$pw" postgres:17 >/dev/null
for i in {1..45}; do docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null && break; sleep 1; done
export INTAKE_TEST_ALLOW_CREATE_DATABASE=owned-sandbox
if [[ -n "$app_image" ]]; then
  export INTAKE_TEST_ADMIN_URL="postgresql://postgres:$pw@127.0.0.1:5432/postgres"
  export INTAKE_VM_PORT=14313 INTAKE_VM_PAIR=/tmp/bench-pair
  docker run --rm -d --name "$app" --network="container:$db" --cap-drop=ALL --security-opt=no-new-privileges \
    --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m --memory=900m --cpus=2 \
    -v "$root/intake-server/tests:/app/intake-server/tests:ro" \
    -e INTAKE_TEST_ADMIN_URL -e INTAKE_TEST_ALLOW_CREATE_DATABASE -e INTAKE_VM_PORT -e INTAKE_VM_PAIR \
    "$app_image" sleep infinity >/dev/null
  COPYFILE_DISABLE=1 tar -C "$state/host" -cf - . | docker exec -i "$app" sh -ec 'umask 077; mkdir /tmp/bench-pair; tar -xf - --no-same-owner -C /tmp/bench-pair'
  if command -v node >/dev/null; then runtime=node; else
    docker cp "$app:/usr/local/bin/node" "$state/node"
    runtime="$state/node"
  fi
  "$runtime" "$root/tooling/deployment/bridge/relay.mjs" "$vm" "$INTAKE_VM_PORT" "$remote" "$image" "$app" &
  relay=$!
  test_node=(docker exec "$app" node)
else
  dbport=$(docker port "$db" 5432/tcp | cut -d: -f2)
  export INTAKE_TEST_ADMIN_URL="postgresql://postgres:$pw@127.0.0.1:$dbport/postgres"
  export INTAKE_VM_PAIR="$state/host"
  export INTAKE_VM_PORT=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  node "$root/tooling/deployment/bridge/relay.mjs" "$vm" "$INTAKE_VM_PORT" "$remote" "$image" &
  relay=$!
  test_node=(node)
fi
cd "$root/intake-server"
"${test_node[@]}" --import tsx --test tests/process/shared-vm.test.ts
"${test_node[@]}" --import tsx --test --test-name-pattern="the session worker runs a synthetic session" tests/process/session-worker.test.ts
count=$(limactl shell --workdir=/ "$vm" sudo grep -rlx done "$remote/sessions" | wc -l)
test "$count" -eq 4
