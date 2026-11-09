#!/bin/sh
# Isolated deployment qualification. The randomized project owns its databases and volumes.
set -eu
vm=${1:?dedicated Lima VM name}
export INTAKE_APP_IMAGE=${2:?selected local ARM64 app image}
previous=${3:-$INTAKE_APP_IMAGE}
case "$vm" in -*|*[!a-z0-9-]*) exit 2 ;; esac
manifest=$(dirname "$0")/../host.compose.yaml
state=$(mktemp -d)
chmod 700 "$state"
project=bench-release-$(openssl rand -hex 8)
export INTAKE_ADMIN_PASSWORD_FILE="$state/admin" INTAKE_API_PASSWORD_FILE="$state/api"
compose() { docker compose -p "$project" -f "$manifest" "$@"; }
cleanup() {
  compose down --volumes >/dev/null
  rm -f "$state/admin" "$state/api" "$state/canary"
  rmdir "$state"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP
for secret in "$state/admin" "$state/api"; do
  openssl rand -hex 32 > "$secret"
  chmod 444 "$secret"
done
touch "$state/canary"
limactl shell --workdir=/ "$vm" sh -ec '
  test ! -e "$1"
  ! grep -Eq " - (virtiofs|9p|fuse.sshfs) " /proc/self/mountinfo
' sh "$state/canary"
compose up -d api >/dev/null
api() { compose exec -T api "$@"; }
ready() {
  i=0
  until api node -e 'fetch("http://127.0.0.1:4310/api/v1/bootstrap").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; do
    i=$((i+1))
    [ "$i" -lt 60 ] || { compose logs api; exit 1; }
    sleep 1
  done
}
ready
test "$(api cat /proc/sys/kernel/random/boot_id)" != "$(limactl shell --workdir=/ "$vm" cat /proc/sys/kernel/random/boot_id)"
api node -e 'fetch("http://127.0.0.1:4310/api/v1/bootstrap",{headers:{origin:"https://untrusted.invalid"}}).then(r=>process.exit(r.status===403?0:1))'
api sh -ec 'test ! -e /var/run/docker.sock; test ! -e /run/secrets/admin_password; printf "%s" "$1" > /var/lib/intake/blobs/qualification' sh "$project"
check_role() {
  api node -e '
  const {Pool}=require("pg");const fs=require("node:fs");
  process.env.PGPASSWORD=fs.readFileSync("/run/secrets/api_password","utf8").trim();
  const db=new Pool({connectionString:process.env.INTAKE_DATABASE_URL,connectionTimeoutMillis:5000});
  (async()=>{const {rows:[role]}=await db.query("select current_user,rolsuper,rolcreaterole,rolcreatedb from pg_roles where rolname=current_user");
    if(role.current_user!=="intake_api" || role.rolsuper || role.rolcreaterole || role.rolcreatedb) throw Error("unexpected runtime role")
  })().catch(e=>{console.error(e.code || e.message);process.exitCode=1}).finally(()=>db.end())'
}
check_role
selected=$INTAKE_APP_IMAGE
for replacement in "$previous" "$selected"; do
  export INTAKE_APP_IMAGE=$replacement
  compose up -d --no-deps --force-recreate api >/dev/null
  ready
  check_role
  test "$(api cat /var/lib/intake/blobs/qualification)" = "$project"
done
echo 'Verified guest kernel and mounts, origin enforcement, restricted API role and retained blob across replacement.'
