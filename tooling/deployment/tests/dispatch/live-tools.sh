#!/bin/bash
# Run once per already-linked subscription, with a fresh test database and visual challenge.
set -euo pipefail
vm=${1:?VM name} dir=${2:?private guest directory} image=${3:?worker image}
export INTAKE_VM_PAIR=${4:?coordinator pairing directory} INTAKE_TEST_TOOL_PROVIDER=${5:?claude or codex}
case $INTAKE_TEST_TOOL_PROVIDER in
  claude) export INTAKE_VM_CLAUDE_SUBSCRIPTION=1 ;;
  codex) export INTAKE_VM_CODEX_SUBSCRIPTION=1 ;;
  *) exit 2 ;;
esac
root=$(cd "$(dirname "$0")/../../../.." && pwd)
guest() { limactl shell --workdir=/ "$vm" sudo "$@"; }
guest test -S "$dir/web/reader.sock"
guest install -d -m 0700 -o 1000 -g 1000 "$dir/tool-sessions"
fixture=$(guest mktemp -d "$dir/tool-sessions/qualification.XXXXXXXX")
guest chown 1000:1000 "$fixture"
export INTAKE_TEST_TOOL_CASE=${fixture##*/}
export INTAKE_TEST_IMAGE_WORD=$(python3 -c 'import secrets; print("".join(secrets.choice("ACDEHKMPRTVWX") for _ in range(5)))')
inspect_fixture() {
  guest docker run --rm -i --network=none --cap-drop=ALL --security-opt=no-new-privileges \
    --read-only -v "$fixture:/fixture" "$image" "$@"
}
db="bench-tool-test-$(openssl rand -hex 6)"
relay=''
cleanup() {
  if [[ -n $relay ]]; then kill "$relay" 2>/dev/null || true; fi
  docker rm -f "$db" >/dev/null 2>&1 || true
  guest rm -rf "$fixture"
}
trap cleanup EXIT
printf %s "$INTAKE_TEST_IMAGE_WORD" | inspect_fixture python3 -c '
from PIL import Image, ImageDraw, ImageFont
import sys
picture = Image.new("RGB", (440, 115), "white")
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 72)
ImageDraw.Draw(picture).text((18, 14), sys.stdin.read(), font=font, fill="black")
picture.save("/fixture/image.png")'
pw=$(openssl rand -hex 32)
docker run -d --rm --name "$db" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD="$pw" postgres:17 >/dev/null
for i in {1..45}; do docker exec "$db" pg_isready -h 127.0.0.1 -U postgres >/dev/null && break; sleep 1; done
port=$(docker port "$db" 5432/tcp | cut -d: -f2)
export INTAKE_TEST_ADMIN_URL="postgresql://postgres:$pw@127.0.0.1:$port/postgres" INTAKE_TEST_ALLOW_CREATE_DATABASE=owned-sandbox
export INTAKE_VM_PORT=${INTAKE_VM_PORT:-14319} INTAKE_VM_BUILTIN_TOOLS=1
node "$root/tooling/deployment/bridge/relay.mjs" "$vm" "$INTAKE_VM_PORT" "$dir" "$image" &
relay=$!
(cd "$root/intake-server" && node --import tsx --test tests/process/shared-vm-tools.test.ts)
inspect_fixture python3 -c '
from pathlib import Path
assert Path("/fixture/qualification.py").stat().st_size > 0
text = Path("/fixture/rfc.txt").read_text()
assert "ISSN: 2070-1721" in text and "HTTP Semantics" in text and len(text) > 100000
print("Verified the agent-created script and saved public document.")'
