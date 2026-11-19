#!/bin/sh
# Run in a network-disabled worker. Denials must happen inside the reader and the egress proxy.
set -eu
test "$(id -u)" = 1000
test "$(ls /sys/class/net)" = lo
for path in /run/bench-pair /run/operator /var/run/docker.sock /Users /mnt/lima-cidata; do
  test ! -e "$path"
done
for origin in host.lima.internal host.docker.internal inventory.invalid 169.254.169.254 '[::1]' "${1:-inventory.invalid}"; do
  status=$(curl --silent --noproxy '*' --unix-socket /run/web/reader.sock --output /dev/null --write-out '%{http_code}' "http://localhost/https://$origin/")
  test "$status" = 403
done
# The turn policy never enters the worker, and without one the egress refuses public hosts.
test ! -e /run/policy
for egress in /run/egress/*.sock; do
  python3 - "$egress" <<'PY'
import pathlib
import socket
import sys
import time
egress = sys.argv[1]
provider = {"claude.sock": "api.anthropic.com", "codex.sock": "chatgpt.com"}[pathlib.Path(egress).name]


def connect(host):
    """The proxy's complete response header, within 10 s and 8 KiB, or an assertion error."""
    deadline = time.monotonic() + 10
    reply = b""
    def remaining():
        left = deadline - time.monotonic()
        assert left > 0, reply
        return left

    with socket.socket(socket.AF_UNIX) as tunnel:
        tunnel.settimeout(remaining())
        tunnel.connect(egress)
        tunnel.settimeout(remaining())
        tunnel.sendall(f"CONNECT {host}:443 HTTP/1.1\r\n\r\n".encode())
        while b"\r\n\r\n" not in reply:
            assert len(reply) < 8192, reply
            tunnel.settimeout(remaining())
            chunk = tunnel.recv(8192 - len(reply))
            assert chunk, reply
            reply += chunk
    return reply


# The provider still connects, so the refusal below comes from the policy, not a dead proxy.
assert connect(provider).startswith(b"HTTP/1.1 200"), provider
reply = connect("www.rfc-editor.org")
assert reply.startswith(b"HTTP/1.1 403"), reply
assert b"X-Bench-Refusal: destination_refused\r\n" in reply, reply
PY
done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cat > "$work/check.py" <<'PY'
import pathlib
import subprocess
import sys
from PIL import Image
root = pathlib.Path(sys.argv[1])
with Image.new("RGB", (16, 12), (18, 27, 51)) as image:
    image.crop((1, 2, 8, 9)).save(root / "crop.png")
with Image.open(root / "crop.png") as image:
    assert image.size == (7, 7) and image.getpixel((2, 2)) == (18, 27, 51)
with (root / "rfc.txt").open("wb") as output:
    subprocess.run(["bench-web", "https://www.rfc-editor.org/rfc/rfc9110.txt"], stdout=output, check=True)
assert "ISSN: 2070-1721" in (root / "rfc.txt").read_text()
PY
python3 "$work/check.py" "$work"
echo 'Guest script, file, image, public HTTPS and destination checks passed.'
