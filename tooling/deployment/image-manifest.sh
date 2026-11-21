#!/bin/sh
# Emit the portable configuration digest from the two engines.
set -eu
exec python3 - "$@" <<'PY'
import hashlib
import json
import re
import subprocess
import sys
import tarfile


def identity(engine, image):
    info, = json.loads(subprocess.check_output([*engine, "image", "inspect", "--", image]))
    if (info["Os"], info["Architecture"]) != ("linux", "arm64"):
        raise ValueError("expected one Linux ARM64 image")
    digest = info["Id"]
    # Some containerd-backed engines report the manifest digest as Id.
    if digest == info.get("Descriptor", {}).get("digest"):
        files = {}
        manifest = None
        with subprocess.Popen([*engine, "image", "save", "--platform", "linux/arm64", "--", image],
                              stdout=subprocess.PIPE) as proc:
            with tarfile.open(fileobj=proc.stdout, mode="r|*") as archive:
                for entry in archive:
                    if not entry.isfile() or entry.size > 1024 * 1024:
                        continue
                    data = archive.extractfile(entry).read()
                    files[entry.name] = hashlib.sha256(data).hexdigest()
                    if entry.name == "manifest.json":
                        manifest = json.loads(data)
            # tar ends before its padding. Drain stdout so the exporting engine can finish.
            while proc.stdout.read(65536):
                pass
            if proc.wait() != 0:
                raise ValueError("could not export the selected image")
        record, = manifest
        digest = "sha256:" + files[record["Config"]]
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("invalid configuration digest")
    return "linux/arm64 " + digest


vm, app, runner = sys.argv[1:]
if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", vm):
    sys.exit("expected a dedicated Lima VM name")
host = identity(["docker"], app)
guest = identity(["limactl", "shell", "--workdir=/", vm, "sudo", "docker"], runner)
print("app", host)
print("runner", guest)
PY
