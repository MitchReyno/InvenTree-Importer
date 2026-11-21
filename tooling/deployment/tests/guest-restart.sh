#!/bin/sh
# Stops and restarts the explicitly selected qualification VM. Run only on a drained test VM.
set -eu
vm=${1:?dedicated test VM} candidate=${2:?candidate runner image} previous=${3:?compatible previous image}
case "$vm" in -*|*[!a-z0-9-]*) exit 2 ;; esac
volume=bench-restart-$(openssl rand -hex 8)
guest() { limactl shell --workdir=/ "$vm" sudo "$@"; }
boot=$(guest cat /proc/sys/kernel/random/boot_id)
guest docker volume create "$volume" >/dev/null
trap 'guest docker volume rm "$volume" >/dev/null' EXIT
run() {
  guest docker run --rm --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges \
    --tmpfs /tmp:size=8m -v "$volume:/home/node" "$1" node --input-type=module -e '
      import { journalTurn } from "./src/agents/shared-vm/journal.ts";
      const outcome = await journalTurn("/home/node/restart-entry",{turn:"1",case:"restart"},async () => {
        if (process.argv[1] !== "first") throw Error("attempt to replay completed turn");
        return "done";
      });
      if (outcome !== "done") throw Error("unexpected terminal outcome");
    ' "$2"
}
run "$candidate" first
limactl stop "$vm"
limactl start --tty=false "$vm"
test "$boot" != "$(guest cat /proc/sys/kernel/random/boot_id)"
run "$previous" rollback
run "$candidate" replacement
echo 'Verified guest reboot, compatible runner rollback and no repeat execution.'
