#!/bin/sh
# Run inside the tools container. No account, network, or real evidence needed.
set -eu
test "$(id -u)" = 1000
test ! -S /var/run/docker.sock
claude --version
codex --version
test -s /opt/guest-tools/node_modules/@anthropic-ai/claude-code/LICENSE.md
test -s /opt/guest-tools/node_modules/@anthropic-ai/claude-code/README.md
test -s /usr/share/doc/codex/CODEX-LICENSE
test -s /usr/share/doc/codex/CODEX-NOTICE
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cat > "$work/crop.py" <<'PY'
from pathlib import Path
import sys
from PIL import Image

root = Path(sys.argv[1])
source = root / "source.png"
Image.new("RGB", (24, 24), (17, 92, 121)).save(source)
with Image.open(source) as image:
    image.crop((4, 5, 12, 15)).save(root / "crop.png")
with Image.open(root / "crop.png") as crop:
    assert crop.size == (8, 10)
    assert crop.getpixel((0, 0)) == (17, 92, 121)
PY
python3 "$work/crop.py" "$work"
node -e 'if (process.arch !== "arm64") process.exit(1)'
printf '<title>synthetic fixture</title>' > "$work/index.html"
timeout -k 5s 60s chromium --headless --disable-gpu --disable-dev-shm-usage --user-data-dir="$work/browser" \
    --dump-dom "file://$work/index.html" > "$work/result.html"
grep -q '<title>synthetic fixture</title>' "$work/result.html"
