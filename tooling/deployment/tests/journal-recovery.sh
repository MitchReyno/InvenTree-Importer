#!/bin/sh
# Run inside a qualification VM. Uses disposable containers and one fresh named volume.
set -eu
image=${1:?provide the loaded runner image}
label=$(mktemp -d)
name=bench-recovery-${label##*.}
volume=$name-state
cleanup() {
  docker rm -f "$name-a" "$name-b" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rmdir "$label"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP
docker volume create "$volume" >/dev/null
run() {
  docker run --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only \
    --pids-limit=64 --memory=128m --tmpfs /tmp:size=8m --volume "$volume:/home/node" "$@"
}
# Both sessions hold an active journal entry. An independent descendant increments a heartbeat.
program='
import { journalTurn } from "./src/agents/shared-vm/journal.ts";
import { appendFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const path = "/home/node/" + process.argv[1];
try {
  const result = await journalTurn(path, {turn:1}, async () => {
    await appendFile(path + ".effects", "started\n");
    const child = spawn(process.execPath, ["-e", "setInterval(()=>require(\"node:fs\").appendFileSync(process.argv[1],\".\"),100)", path + ".heartbeat"], {detached:true,stdio:"ignore"});
    try {
      while (await readFile(path + ".finish").catch(() => null) === null) await delay(100);
      return "done";
    } finally { child.kill(); }
  });
  console.log(result);
} catch (error) {
  if (error.message !== "turn_requires_reconciliation") throw error;
  console.log(error.message);
}'
for slot in a b; do
  run -d --name "$name-$slot" "$image" node --input-type=module -e "$program" "$slot" >/dev/null
done
i=0
until docker exec "$name-b" sh -c 'test -s /home/node/a.heartbeat && test -s /home/node/b.heartbeat'; do
  i=$((i+1))
  [ "$i" -lt 60 ] || exit 1
  sleep 1
done
docker kill "$name-a" >/dev/null
docker exec "$name-b" sh -ec '
  size=$(wc -c < /home/node/a.heartbeat)
  sleep 1
  test "$size" -eq "$(wc -c < /home/node/a.heartbeat)"
  touch /home/node/a.finish /home/node/b.finish
'
test "$(docker wait "$name-b")" = 0
test "$(docker logs "$name-b")" = done
for slot in a b; do
  result=$(run --rm "$image" node --input-type=module -e "$program" "$slot")
  case "$slot/$result" in a/turn_requires_reconciliation|b/done) ;; *) exit 1 ;; esac
done
run --rm "$image" sh -ec 'test "$(wc -l < /home/node/a.effects)" -eq 1 && test "$(wc -l < /home/node/b.effects)" -eq 1'
echo 'Verified independent completion, descendant termination and no replay after runner replacement.'
