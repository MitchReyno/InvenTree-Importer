#!/bin/sh
# Runs inside the dedicated Linux VM. Only the paired supervisor owns the journal and TLS identity.
set -eu
directory=$1 image=$2 provider=$3
case $provider in claude|codex) ;; *) exit 2 ;; esac
turn=$(mktemp -d)
name=bench-tool-${turn##*.}
cleanup() {
  docker rm -f "$name" "$name-peer" "$name-egress" >/dev/null 2>&1 || true
  rm -rf "$turn"
}
trap cleanup EXIT
trap 'exit 1' TERM HUP INT
install -d -m 0700 -o 1000 -g 1000 "$turn/rpc"
install -d -m 0700 -o 1000 -g 1000 "$directory/tool-sessions"
test -S "$directory/web/reader.sock"
protected=$(cat "$directory/tool-protected-hosts")
install -d -m 0700 -o 1000 -g 1000 "$turn/egress"
isolated() { docker run --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=128 "$@"; }

if [ "$provider" = claude ]; then
  envarg=INTAKE_VM_CLAUDE_SUBSCRIPTION=1
  set -- --volume "$directory/claude-store:/run/claude-store:ro" --volume "$turn/egress:/run/egress:ro" \
    --tmpfs /home/node/.claude:uid=1000,gid=1000,mode=700,size=32m --tmpfs /home/node/.config:uid=1000,gid=1000,mode=700,size=4m
else
  envarg=INTAKE_VM_CODEX_SUBSCRIPTION=1
  set -- --volume "$directory/codex-state:/run/codex-state" --volume "$turn/egress:/run/egress:ro"
fi
docker run -d --name "$name-egress" --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit=24 --memory=64m --env "$envarg" --env "INTAKE_VM_PROTECTED_HOSTS=$protected" \
  --volume "$turn/egress:/run/egress" "$image" python3 /opt/guest-tools/claude-egress.py >/dev/null
isolated -d --name "$name" --memory=640m --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --env "$envarg" "$@" --volume "$turn/rpc:/run/turn" --volume "$directory/web:/run/web:ro" \
  --volume "$directory/tool-sessions:/home/node/sessions" "$image" node --import tsx src/agents/shared-vm/tool-worker.ts >/dev/null
i=0
while [ "$i" -lt 150 ]; do
  [ -S "$turn/rpc/worker.sock" ] && break
  i=$((i + 1))
  sleep .1
done
test -S "$turn/rpc/worker.sock"
isolated --rm -i --name "$name-peer" --memory=256m --tmpfs /tmp:size=16m \
  --env "$envarg" --env INTAKE_VM_TOOL_WORKER=1 --volume "$turn/rpc:/run/turn:ro" \
  --volume "$directory/guest:/run/bench-pair:ro" --volume "$directory/sessions:/home/node/sessions" \
  "$image" node --import tsx src/agents/shared-vm/guest-main.ts
