#!/bin/bash
# Run once per already-linked subscription, with a fresh test database and visual challenge.
set -euo pipefail
vm=${1:?VM name} dir=${2:?private guest directory} image=${3:?worker image}
export INTAKE_VM_PAIR=${4:?coordinator pairing directory} INTAKE_TEST_TOOL_PROVIDER=${5:?claude or codex}
# off: the attempt seals public pages off; on: it seals public pages and datasheet guidance.
export INTAKE_TEST_TOOL_WEB=${6:-off}
case $INTAKE_TEST_TOOL_WEB in on|off) ;; *) exit 2 ;; esac
# research: a lot session; examine: the batch-level session.
export INTAKE_TEST_TOOL_STAGE=${7:-research}
case $INTAKE_TEST_TOOL_STAGE in research|examine) ;; *) exit 2 ;; esac
case $INTAKE_TEST_TOOL_PROVIDER in
  claude) export INTAKE_VM_CLAUDE_SUBSCRIPTION=1 ;;
  codex) export INTAKE_VM_CODEX_SUBSCRIPTION=1 ;;
  *) exit 2 ;;
esac
root=$(cd "$(dirname "$0")/../../../.." && pwd)
guest() { limactl shell --workdir=/ "$vm" sudo "$@"; }
guest install -d -m 0700 -o 1000 -g 1000 "$dir/tool-sessions"
fixture=$(guest mktemp -d "$dir/tool-sessions/qualification.XXXXXXXX")
db="bench-tool-test-$(openssl rand -hex 6)"
relay=''
cleanup() {
  if [[ -n $relay ]]; then kill "$relay" 2>/dev/null || true; fi
  docker rm -f "$db" >/dev/null 2>&1 || true
  guest rm -rf "$fixture"
}
trap cleanup EXIT
guest chown 1000:1000 "$fixture"
export INTAKE_TEST_TOOL_CASE=${fixture##*/}
export INTAKE_TEST_IMAGE_WORD=$(python3 -c 'import secrets; print("".join(secrets.choice("ACDEHKMPRTVWX") for _ in range(5)))')
host_get() { curl -fsS --connect-timeout 10 --max-time 120 "$@"; }
# Claude's WebFetch target is a random recent RFC; only the fixture check sees its title.
export INTAKE_TEST_FETCH_RFC=$((9500 + RANDOM % 200)) INTAKE_TEST_FETCH_TITLE=''
if [[ $INTAKE_TEST_TOOL_PROVIDER == claude && $INTAKE_TEST_TOOL_WEB == on ]]; then
  for attempt in 1 2 3 4 5; do
    INTAKE_TEST_FETCH_TITLE=$(host_get "https://www.rfc-editor.org/rfc/rfc$INTAKE_TEST_FETCH_RFC.html" |
      python3 -c 'import html, re, sys; m = re.search(r"<title>RFC \d+: ([^<]+)</title>", sys.stdin.read()); print(html.unescape(m.group(1)).strip() if m else "")') || true
    [[ -n $INTAKE_TEST_FETCH_TITLE ]] && break
    INTAKE_TEST_FETCH_RFC=$((9500 + RANDOM % 200))
  done
  [[ -n $INTAKE_TEST_FETCH_TITLE ]]
fi
# With web on, the agent's download must match the bytes the host fetches itself.
pdf_sha256=''
if [[ $INTAKE_TEST_TOOL_WEB == on ]]; then
  pdf_sha256=$(host_get https://www.rfc-editor.org/rfc/rfc9110.pdf | openssl dgst -sha256 -r | cut -d' ' -f1)
fi
inspect_fixture() {
  guest docker run --rm -i --network=none --cap-drop=ALL --security-opt=no-new-privileges \
    --read-only -v "$fixture:/fixture" "$image" "$@"
}
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
inspect_fixture python3 - "$INTAKE_TEST_TOOL_WEB" "$pdf_sha256" "$INTAKE_TEST_TOOL_PROVIDER" "$INTAKE_TEST_FETCH_TITLE" <<'PY'
import hashlib
import sys
from pathlib import Path
# Failures report sizes and line numbers only: the files are agent-written.
assert Path("/fixture/qualification.py").stat().st_size > 0
if sys.argv[1] == "off":
    text = Path("/fixture/web.txt").read_text()
    assert "X-Bench-Refusal: destination_refused" in text and "ISSN: 2070-1721" not in text, len(text)
    print("Verified the agent-created script and the refused public page.")
else:
    pdf = Path("/fixture/rfc9110.pdf").read_bytes()
    assert hashlib.sha256(pdf).hexdigest() == sys.argv[2], len(pdf)
    # curl -v: the proxy's answer is the "< " block right after the "> CONNECT" it sent.
    lines = Path("/fixture/private.txt").read_text().splitlines()
    sent = [i for i, line in enumerate(lines) if line.startswith("> CONNECT 10.0.0.1:443 ")]
    assert len(sent) == 1, len(sent)
    answer = []
    for line in lines[sent[0] + 1:]:
        if line.startswith("< "):
            answer.append(line[2:].strip())
        elif answer:
            break
    answer = [line for line in answer if line]
    assert answer and answer[0].startswith("HTTP/1.1 403 "), len(answer)
    assert "X-Bench-Refusal: destination_refused" in answer, len(answer)
    print(f"Verified the downloaded PDF ({len(pdf)} bytes) and the refused private target.")
    if sys.argv[3] == "claude":
        normal = lambda text: " ".join(text.lower().split())
        saved = normal(Path("/fixture/title.txt").read_text())
        expected = normal(sys.argv[4])
        # The page's own title tag reads "RFC NNNN: <title>", so that prefix is allowed.
        assert saved == expected or (saved.startswith("rfc ") and saved.split(": ", 1)[-1] == expected), len(saved)
        print("Verified the WebFetch title of the page the harness chose.")
PY
