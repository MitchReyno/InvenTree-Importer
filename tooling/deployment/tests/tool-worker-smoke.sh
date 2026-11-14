#!/bin/sh
# Run in a network-disabled worker. The denial must happen inside the reader.
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
