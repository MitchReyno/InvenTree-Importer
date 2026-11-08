# Shared VM packaging fixture

From the repository root, build the images in the Mac Docker context.

```sh
export INTAKE_APP_IMAGE=bench-intake-app:shared-vm-fixture
export INTAKE_GUEST_IMAGE=bench-intake-personal-guest:shared-vm-fixture
docker buildx build --load --platform linux/arm64 -f tooling/deployment/images/app.Dockerfile -t "$INTAKE_APP_IMAGE" .
docker buildx build --load --platform linux/arm64 -t "$INTAKE_GUEST_IMAGE" tooling/deployment/guest
```

The personal image contains the operator-installed provider CLIs. Keep it private. Their npm tarball integrity hashes are in the guest lockfile. Codex's LICENSE and NOTICE come from the upstream rust-v0.166.0 tag. The Chromium seccomp profile comes from Playwright v1.56.1, with chroot allowed for the browser's inner user namespace. The container runs as UID 1000 with all container capabilities dropped, no-new-privileges and a read-only root. For the offline fixture, Compose disables networking. OS packages are resolved at build time. Transfer the built image to reuse the exact bytes.

Create two independent 32-byte hex passwords with private file permissions. Use distinct new volumes for a new fixture. PostgreSQL and the API share a network namespace with loopback access only. The database owner is available to the one-shot provisioner. The API gets its own database login and blob volume.

```sh
umask 077
state=$(mktemp -d)
export INTAKE_ADMIN_PASSWORD_FILE="$state/admin" INTAKE_API_PASSWORD_FILE="$state/api"
openssl rand -hex 32 > "$INTAKE_ADMIN_PASSWORD_FILE"
openssl rand -hex 32 > "$INTAKE_API_PASSWORD_FILE"
docker compose -p bench-host-fixture -f tooling/deployment/host.compose.yaml up -d
docker compose -p bench-host-fixture -f tooling/deployment/host.compose.yaml logs api
```

Retain the same password files for subsequent starts of that project. Wait for web_ready, then use the container's loopback to exercise the static app and bootstrap endpoint. The host manifest currently covers database initialization, schema migrations and API startup. The guest manifest currently provides an offline tool container for qualification. Pairing, external UI ingress and provider sign-in require further implementation.

On an Apple Silicon Mac with Lima 2.3 and Docker installed, create a dedicated VM. Run these commands from the repository root in the same shell as the build commands. The pinned Alpine image runs a second Docker engine in the VM. Only the Compose file, browser policy, smoke script and built image cross the boundary.

```sh
vm=bench-agent-m1
limactl start --tty=false --vm-type=vz --name="$vm" tooling/deployment/lima/agent.yaml
docker save "$INTAKE_GUEST_IMAGE" | limactl shell --workdir=/ "$vm" sudo docker load
tar -C tooling/deployment -cf - guest.compose.yaml guest/browser-seccomp.json tests/guest-tools-smoke.sh |
  limactl shell --workdir=/ "$vm" sh -ec 'mkdir -p ~/qualification; tar -xf - -C ~/qualification'
limactl shell --workdir=/ "$vm" sh -ec '
  cd ~/qualification
  sudo env INTAKE_GUEST_IMAGE="$1" docker compose -p bench-guest -f guest.compose.yaml up -d
  sudo docker exec -i bench-guest-tools-1 sh -s < tests/guest-tools-smoke.sh
' sh "$INTAKE_GUEST_IMAGE"
```

If first-boot SSH drops during provisioning, inspect the instance with `limactl list` and the Lima host-agent log. On the qualification M1 a restart of that VM restored SSH. Verify Docker and Compose are present inside the VM before loading the image. To pause the fixture while preserving the guest disk, run `limactl stop "$vm"`.
