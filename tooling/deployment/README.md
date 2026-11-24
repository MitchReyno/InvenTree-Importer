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

Retain the same password files for subsequent starts of that project. Wait for web_ready, then use the container's loopback to exercise the static app and bootstrap endpoint. The host manifest currently covers database initialization, schema migrations and API startup. The guest manifest currently provides an offline tool container for qualification. For app dispatch and account linking, configure the coordinator and provider relays below. Operator-managed authenticated same-origin ingress is required for access outside loopback.

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

### Raspberry Pi 5

Use 64-bit Raspberry Pi OS with a writable KVM device, QEMU, AArch64 UEFI firmware and Lima 2.3. Place the VM, image archives and Docker data on SSD. Check the actual device backing each path before launch. The qualification Pi boots from NVMe, so its home directory and Docker data root already reside there.

```sh
test -r /dev/kvm && test -w /dev/kvm
findmnt -T "$HOME"
findmnt -T "$(docker info --format '{{.DockerRootDir}}')"
qemu-system-aarch64 --version
limactl --version
free -h
vm=bench-pi
limactl start --tty=false --vm-type=qemu --name="$vm" tooling/deployment/lima/agent.yaml
```

For a per-user QEMU installation, include the Debian ipxe-qemu ROMs in QEMU's data directory. Pass that directory via QEMU's `-L` option and point Lima's `firmware.images` entry at the extracted AArch64 UEFI code file. Use the same Compose and smoke commands as on the Mac, substituting the Pi VM name. Transfer private images with `docker save` and `docker load`. Load the app into host Docker and the personal tools into guest Docker. Starting the host fixture requires separate synthetic secrets, a fresh Compose project name and its own volumes.

On an installation that shares RAM with live services, stop the fixture after qualification. From the host manifest directory with the same Compose project and password file variables, use `docker compose -p "$project" -f host.compose.yaml stop` and `limactl stop "$vm"`. Both commands retain fixture data.

### App-to-guest dispatch

Set `INTAKE_PROCESSING_PROFILE=shared-vm-agent/1` on the API and session coordinator. Set `INTAKE_VM_PAIR` and `INTAKE_VM_PORT` on the coordinator. The pairing directory contains a dedicated installation CA certificate in `ca.pem`, the coordinator certificate in `cert.pem` with DNS SAN `bench-coordinator`, and its private key in `key.pem`. The guest identity uses the same filenames with SAN `bench-guest`. Keep the CA signing key offline and the private keys readable only by their owners. The bridge listens on IPv4 loopback inside the coordinator's network namespace.

Build the runner from the compatible ARM64 app and personal tools images. The default target includes the provider CLIs. The controlled-provider target substitutes the two CLI protocols with deterministic executables for offline qualification.

```sh
docker build --build-arg APP_IMAGE="$INTAKE_APP_IMAGE" \
  --build-arg PERSONAL_TOOLS_IMAGE="$INTAKE_GUEST_IMAGE" \
  -f tooling/deployment/images/runner.Dockerfile --target controlled-provider \
  -t bench-intake-runner:controlled .
docker save bench-intake-runner:controlled | limactl shell --workdir=/ "$vm" sudo docker load
tooling/deployment/tests/dispatch/smoke.sh "$vm" bench-intake-runner:controlled
```

The smoke script starts disposable PostgreSQL and issues disposable pairing certificates. It calls the application's Processing HTTP route, lets DBOS deliver each command, and checks retained provider session IDs and MCP status events for Claude and Codex. A separate scripted session submits a proposal, asks a question and resumes after the answer. When testing from the checkout, it requires the pinned Node runtime and installed pnpm workspace dependencies.

For the relay, run `node tooling/deployment/bridge/relay.mjs VM PORT GUEST_DIRECTORY IMAGE` where the coordinator's loopback listener is reachable. The operator-side relay requires Lima management access. Each relay handles one active turn at a time, creating a bounded, network-disabled container in the shared VM and reusing its guest session storage. The guest directory contains `guest/` for the pairing files and `sessions/` writable by UID 1000. Keep it private inside the VM. The ordinary relay supports offline controlled execution. The personal subscription and tool-worker sections below configure the selected account and guest egress services.

To exercise the trusted app in its host Docker image as well, pass the app image as a third argument to the smoke script. It shares only the disposable database's isolated network namespace. For that topology the relay accepts a fifth argument, the coordinator container name, and uses a fixed loopback byte pump inside that container. Host Docker management remains outside both the coordinator and the guest.


For local development, `pnpm vm:setup` does the pairing, provisioning and browser policy steps below in one rerunnable command (README, "VM agent runner"). For another persistent installation, run the pairing command once with a new coordinator directory outside the checkout and a new directory in the guest. Use the same directories on each restart. The certificates last one year. Rotation requires a fresh matched pair.

```sh
tooling/deployment/bridge/pair.sh "$vm" "$INTAKE_VM_PAIR" "$guest_directory"
```

Start the coordinator with the VM profile and its pairing directory, then start the relay using the same port and guest directory. The standard dev launcher reads the two bridge variables for the session worker. For the packaged topology supply the coordinator container name to the relay. Each additional relay permits another simultaneous turn, within the application's configured slot limit.

For an already provisioned installation, layer `host-runner.compose.yaml` over `host.compose.yaml` with Docker Compose's two `-f` arguments. Supply the existing API's private runtime settings in `INTAKE_API_RUNTIME_ENV` and the session coordinator's separately provisioned runtime settings in `INTAKE_COORDINATOR_ENV`. Both need the same actor, target, target context and processing channel secret. The coordinator requires its restricted `INTAKE_AGENT_DATABASE_URL` and its DBOS `INTAKE_AGENT_SCHEDULER_DATABASE_URL`. Set `INTAKE_AGENT_WRITER_DATABASE_URL` to the dedicated Examine writer role for lot formation. The base fixture provisioner creates the API login. Supply pre-provisioned coordinator and scheduler roles and authenticated UI ingress for a personal installation. These are prerequisites for the overlay.

Set `INTAKE_COORDINATOR_PAIR` to a directory readable by UID 1000 containing only the coordinator's three pairing files. Run the relay against the coordinator container on port 14313. PostgreSQL and the bridge stay on namespace-local loopback. The relay has no network endpoint inside the guest container.

### Personal Claude subscription

Use the final `personal` runner image for this deployment. Run the unmodified `claude setup-token` locally and keep its result private. Settings › Agents accepts it for your own Claude Code subscription. The management key below authorizes changes to the VM and is independent of the subscription. [Claude Code authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)

After pairing, provision the guest services. Choose an operator-key file in a private host directory. Both provider scripts check it with `operator-key.sh`, which creates the key only when neither the file nor the guest has one. A key on one side only, or two different keys, stops the script with `vm_operator_key_mismatch` and changes neither. Use the exact browser origin for this installation. A personal HTTPS reverse proxy may front a remote Pi.

```sh
origin=http://127.0.0.1:4330
tooling/deployment/bridge/personal-claude.sh "$vm" "$guest_directory" "$personal_image" "$operator_key_file" "$origin"
```

Forward the private management endpoint to loopback on the machine running the UI proxy. For Lima on the Mac, keep this tunnel open while editing credentials. For the Pi run it on the deployment server using that instance's Lima SSH configuration. `ControlPath=none` gives the tunnel its own connection: Lima's SSH configuration shares one, and through it `ssh` would hand the forward to the shared connection and exit at once. With real agents in the VM, `pnpm dev` runs one tunnel with both forwards itself unless `INTAKE_VM_MANAGED=false` (see [development](../../docs/development.md#running-the-agent-vm-with-the-app)).

```sh
ssh -NT -o ExitOnForwardFailure=yes -o ControlPath=none -F "${LIMA_HOME:-$HOME/.lima}/$vm/ssh.config" \
  -L 127.0.0.1:14315:127.0.0.1:14315 "lima-$vm"
```

For `pnpm dev`, set `INTAKE_RUN_AGENTS_IN_VM=true` with the coordinator pair and port; it enables the dev UI proxy. Real subscription sessions also need `INTAKE_USE_MOCK_AI_AGENTS=false` (see [choosing what the app runs](../../docs/development.md#choosing-what-the-app-runs)). In a packaged deployment, route the exact same-origin path `/personal-runner/claude` to the private tunnel. Preserve the browser Origin and Authorization headers, disable body and authorization-header logging, and exclude the route from caches. The management service verifies the operator key and exact origin, including on status requests. Keep the guest credential directory and operator key outside backups and image builds.

Rerunning a provider script replaces only that provider's two containers, for example to change the origin or move to a new runner image. It refuses with `vm_guest_service_conflict` when a container of the same name mounts another installation's directories, and removes nothing. The credential store, egress and key directories stay, so sign-ins are kept.

In **Settings › Agents → Personal Claude subscription**, enter the management key, choose **Check configuration**, enter the setup token, and explicitly save it. Reopening shows configuration status only. Replace and remove use the last acknowledged revision. Removing the credential blocks future launches. An already running provider process retains its environment until exit.

Start a dedicated subscription relay beside the ordinary relay. The optional final argument is the coordinator container name when the coordinator runs in host Docker.

```sh
INTAKE_VM_CLAUDE_SUBSCRIPTION=1 node tooling/deployment/bridge/relay.mjs \
  "$vm" "$INTAKE_VM_PORT" "$guest_directory" "$personal_image"
```

Choose **Claude**, **Subscription**, and a model in the existing defaults form, then start a new Processing session. Guest management can be offline after the save. The guest egress service must be running during inference. It accepts CONNECT to `api.anthropic.com:443` over a guest Unix socket and pins each outgoing connection to a resolved public IPv4 address. Other session containers receive neither this socket nor the credential volume.

### Sign in with ChatGPT

Run `personal-codex.sh` in an installation paired with `pair.sh`, with the same operator key file as the Claude script; the key rules are the same. The fourth argument must match the exact browser origin.

```sh
tooling/deployment/bridge/personal-codex.sh "$vm" "$guest_directory" "$personal_image" "$origin" "$operator_key_file"
ssh -NT -o ExitOnForwardFailure=yes -o ControlPath=none -F "${LIMA_HOME:-$HOME/.lima}/$vm/ssh.config" \
  -L 127.0.0.1:14317:127.0.0.1:14317 "lima-$vm"
```

For the dev UI set `INTAKE_RUN_AGENTS_IN_VM=true`. For a packaged installation, route the exact same-origin path `/personal-runner/codex` through the private tunnel, using the same header preservation and logging rules as the Claude endpoint. In **Settings › Agents → ChatGPT subscription**, enter the management key and choose **Sign in with ChatGPT**. Enter the displayed code at OpenAI's verification page and approve it. Before starting, enable device code sign-in for Codex in [ChatGPT Security Settings](https://chatgpt.com/#settings/Security) or ask the workspace administrator to enable it. If you enabled the setting after requesting a code, cancel that login and request a new code. The settings panel waits for the guest to confirm a ChatGPT account. **Check ChatGPT connection** reopens an outstanding challenge, and **Disconnect ChatGPT** logs out the guest account. The guest refuses credential changes while a Codex subscription turn holds the account lock. [Codex app-server authentication](https://developers.openai.com/codex/app-server#authentication)

Start a dedicated Codex subscription relay alongside any other relays. The guest’s persistent `codex-state` directory holds Codex credentials and session data. Keep it private and exclude it from backups. The subscription container receives a provider-specific HTTPS proxy that accepts `auth.openai.com` and `chatgpt.com` on port 443.

```sh
INTAKE_VM_CODEX_SUBSCRIPTION=1 node tooling/deployment/bridge/relay.mjs \
  "$vm" "$INTAKE_VM_PORT" "$guest_directory" "$personal_image"
```

Choose **Codex** and **Subscription** in the default settings form before starting a new Processing session. The opt-in process test uses `INTAKE_TEST_LIVE_CODEX=chatgpt-subscription` and requires the paired guest and a disposable PostgreSQL instance.

### Provider status without the key

The intake server reads each provider's sign-in status without the management key, at `GET /api/v1/agents/provider-status`: whether a Claude setup token is saved (with its save time, when this image recorded one), and whether Codex is signed in, signing in or signed out, each with the time it was checked. Codex's sign-in is checked in the background, at most once a minute unless **Check again** asks, because one check takes longer than the read may wait; the read reports the last check and when it ran, and "checking" until the first one finishes. Settings › Agents shows it on the provider cards once they use this read; until then the panels above still check status with the key. The key stays needed for every credential change and for the protected read that a change starts from. A provider whose status can't be read is unknown with the reason, never signed out: no agent sessions in this deployment, the session worker didn't answer, the VM isn't connected, the credential service is missing or older than the status read, it is busy with a sign-in change, it didn't answer in time, or Codex's first check hasn't finished. When a provider's latest session used the subscription and the provider refused its sign-in, the answer also names that session.

The read never changes sign-in state: it opens the Claude store read-only, and reads the Codex account without a refresh or any sign-in action (the Codex app-server may still write its own caches and logs, as it does for every turn). Each credential process serves it on a private socket inside its own container, published nowhere: the browser-facing management port has no status path. The subscription relay for each provider carries one status connection from that socket to the coordinator, with `docker exec`, and the credential process authenticates it with the guest pairing identity, so only the paired coordinator can ask. The provider scripts therefore mount the guest pairing directory read-only into the two management containers. The API asks the session worker through the database and waits at most 2 seconds.

A runner image that changes the guest needs the image refreshed, and the provider scripts run again so the management containers restart on it with the pairing mount. Managed `pnpm dev` rebuilds the image and reprovisions the containers; with `INTAKE_VM_MANAGED=false` it only warns that the image is stale, so run `pnpm vm:setup`. For another installation, load the new image and rerun `personal-claude.sh` and `personal-codex.sh`, then restart the subscription relays. Until then the status reads as unknown (`guest_outdated` or `service_unavailable`), and credential management keeps working.

### Shared VM sessions with native tools

Select `INTAKE_PROCESSING_PROFILE=shared-vm-agent/3` on both the API and coordinator. Run the current migrations and use matching app and personal runner images. The profile ID is sealed when a job is queued. A `shared-vm-agent/3` coordinator fails any retained `shared-vm-agent/2` attempt with `agent_profile_retired`, keeping its history; run that step again. The tool worker currently supports the two personal subscription routes.

The coordinator also needs `INTAKE_AGENT_PROTECTED_ORIGINS` in `INTAKE_COORDINATOR_ENV`: a comma-separated list of the absolute origins the app is served under and the InvenTree origins it reads or writes, such as `https://bench.example.com,https://inventory.example.com`. `pnpm dev` sets it automatically. The coordinator turns each origin into a protected host and sends them with every tool turn. Each turn's provider tunnel refuses those hosts, their subdomains and their public addresses. Without the setting, or with an origin it can't represent, the coordinator refuses to start with `session_agent_configuration_required`.

After provisioning pairing and provider access, install the guest browser policy. There is no separate document reader: each tool turn's egress proxy enforces the turn's web policy.

```sh
bash tooling/deployment/bridge/browser-policy.sh "$vm" "$guest_directory"
INTAKE_VM_BUILTIN_TOOLS=1 INTAKE_VM_CLAUDE_SUBSCRIPTION=1 \
  node tooling/deployment/bridge/relay.mjs "$vm" "$port" "$guest_directory" "$runner_image"
```

For ChatGPT-backed sessions, start a second relay with `INTAKE_VM_CODEX_SUBSCRIPTION=1` in place of the Claude flag. Add the coordinator container name as the final argument for a containerized coordinator. Each relay handles one turn at a time. Each running tool worker has a 640 MiB memory ceiling and its paired supervisor has a 256 MiB ceiling. The provider tunnel has a 64 MiB ceiling. Size the VM for the number of simultaneous turns.

Agents use their native shell, file and image tools and provider web search; Claude sessions also have `WebFetch`. `curl` and `WebFetch` reach the web through the turn's egress proxy (`HTTPS_PROXY`). It always allows the provider's hosts. It allows public HTTPS hosts only when the turn's sealed policy turns public pages on, and only on port 443 to names whose every DNS answer is public and none protected. A refusal is `403` with the reason in `X-Bench-Refusal`. Public websites receive any data the operator or agent puts in a permitted URL.

For live qualification on an already linked test deployment, run the following for `provider=claude` and `provider=codex`, each with `web=off` and `web=on`, and each for `stage=research` (a lot session) and `stage=examine` (the batch-level session). The harness uses host Docker for a disposable PostgreSQL instance and Lima for agent execution. Run the cases one at a time: each starts a relay on `INTAKE_VM_PORT`, which defaults to 14319, so parallel runs need distinct ports.

- **`web=off`:** the attempt seals public pages off. The harness stages a random image in a unique guest directory and checks the app status against its answer. It verifies the saved Python script and that the proxy refused a public page. Claude's `WebFetch` must fail too.
- **`web=on`:** the attempt seals public pages and datasheet guidance. The status must report a provider search result whose URL is on `ti.com`. Claude must also read a random recent RFC with `WebFetch` and save its title in the fixture. The harness reads that title itself, keeps it out of the prompt and requires the saved title to match it. The harness checks that `curl` downloaded the same RFC 9110 PDF bytes the host fetches, and that the proxy answered the `CONNECT` to a private address with its refusal.

```sh
bash tooling/deployment/tests/dispatch/live-tools.sh \
  "$vm" "$guest_directory" "$runner_image" "$coordinator_pair_directory" "$provider" "$web" "$stage"
```

### Verify a release or roll back the image pair

Build the personal target with the same app and tools image references used for qualification. Give the app and the resulting runner version-specific tags. Load the app into host Docker and the runner into the dedicated Lima guest. On the source installation, record the full image configuration digests and platforms from both engines.

```sh
tooling/deployment/image-manifest.sh "$vm" "$app_image" "$runner_image" > release.images
```

Transfer the two images and the manifest through your trusted deployment channel. On the destination, run the same command with the local VM name into a temporary file and compare the result before starting the services.

```sh
observed=$(mktemp)
tooling/deployment/image-manifest.sh "$vm" "$app_image" "$runner_image" > "$observed" &&
  diff -u release.images "$observed"
```

The verifier uses Python 3 and exports the selected platform when the engine reports a manifest digest as its image ID. These are Docker image configuration digests suitable for verifying a save/load transfer. Pulling from a registry requires the registry manifest digest. Guest OS packages are resolved during the build, so rebuilding the Dockerfiles can produce different images.

Keep the previous image pair and its manifest until the replacement has completed a turn. For an image rollback, drain active sessions, stop the relays and coordinator, verify the previous pair, and restart with those two references and the same pairing, session and credential directories. Check database migration compatibility before starting an older application. If the schema is incompatible, recovery also requires a matching database backup.

### Lost turn acknowledgement

If the bridge disconnects after dispatch, a compatible coordinator has a 15-second window to ask another paired peer on the same route for the recorded outcome. The peer reads the journal entry for the same lineage, attempt, turn and command digest. A complete match lets the coordinator settle the original session without invoking the provider again.

A missing, partial or conflicting journal leaves the session awaiting reconciliation. Preserve the guest session journal and investigate the retained attempt before retrying. For a compatible tool worker, cancellation closes the original relay and starts a separate removal check. The VM launcher removes that worker container and records the exact command digest. A paired supervisor verifies that receipt before the coordinator releases the slot. A missing receipt keeps the slot held. This recovery window applies to a running coordinator. A coordinator process restart still follows the retained interruption workflow.

### Packaged media decoding

Build the decoder from the repository's media Dockerfile and the dispatcher from the same app image as the media worker. The dispatcher uses a pinned Docker CLI. Build these as private Linux ARM64 images, load them into the trusted host engine, and obtain the decoder image ID on that engine.

```sh
docker buildx build --load --platform linux/arm64 -f intake-server/media-image/Dockerfile -t "$decoder_tag" .
docker buildx build --load --platform linux/arm64 --build-arg APP_IMAGE="$INTAKE_APP_IMAGE" \
  -f tooling/deployment/images/dispatcher.Dockerfile -t "$INTAKE_DISPATCHER_IMAGE" .
export INTAKE_MEDIA_DECODER_IMAGE=$(docker image inspect --format '{{.Id}}' "$decoder_tag")
```

Layer `host-media.compose.yaml` over `host.compose.yaml`. Set `INTAKE_ENGINE_SOCKET` to the trusted engine socket path and `INTAKE_ENGINE_SOCKET_GID` to its numeric group **as seen inside Linux containers**. Set `INTAKE_MEDIA_RUNTIME_ENV` to the private file containing the media worker's restricted database URL and provisioned actor, target and target-context IDs. Use the same retained blob volume as the API.

Start `decoder-dispatch` and use `docker compose run --rm media` with the selected manifests to process one eligible retained command. Only the dispatcher receives the Docker socket. Its Unix endpoint accepts a bounded binary decoder request for the configured immutable image. Media workers have read-only access to that endpoint. The dispatcher has no database credentials, blob mounts or network interface beyond loopback. The decoder image executes with the existing per-command resource, mount and network limits. A dispatcher failure propagates to the media worker through the existing failed-command handling.

Run `tests/decoder-dispatch.sh` from this directory inside a disposable Linux engine with the app, dispatcher and decoder image names as arguments. The smoke test renders a synthetic image through the socket and checks refusal of a different image. It requires no stored evidence or inventory connection.

Run `tests/host-replacement.sh` with the dedicated VM name, candidate app image and previous schema-compatible app image to exercise replacement on one installation. It creates an independent Compose project and removes only its synthetic database and blob volumes. The test checks that the two kernels have distinct boot IDs, Lima exposes no host filesystem mount, the API rejects a foreign origin, and its restricted login and retained blob survive replacement.

### Optional manual Apply service

Include `host-apply.compose.yaml` only for an installation with the existing owned-disposable target and separately provisioned Apply roles. Set `INTAKE_APPLY_CONFIG` to an owner-only runner configuration readable as UID 1000 inside the container. Use `/var/lib/intake/apply` for its gate root and `/var/lib/intake/blobs/store` for its optional attachment source. The service keeps gate evidence in its own volume and mounts blobs read-only. Its fake target must be reachable on the deployment namespace's loopback address. The API and coordinator do not receive its credential. The Apply entrypoint validates the existing target, role and configuration restrictions at startup.

### Qualification, restart and troubleshooting

On the Pi, finish image import and digest verification before starting agent sessions. Drain the dedicated VM before running the restart fixture. From this directory run `tests/guest-restart.sh` with the dedicated VM name, candidate runner image and compatible previous runner image. It changes the VM boot ID, reads the persisted terminal journal with both images and refuses repeated execution. The host Compose project continues running during a guest reboot.

For concurrent cancellation qualification, build the runner Dockerfile's `controlled-lifecycle` target with the same app and tools image arguments as the personal target. Load it into the dedicated VM. Run `tests/dispatch/smoke.sh` with `INTAKE_TEST_VM_LIFECYCLE=controlled`, the VM name, controlled runner and host app image. The fixture opens two paired relays. One worker starts Chromium in its own guest container and deliberately outlives transport loss. The application cancels it, checks capability revocation and confirms its sibling is still running, then lets the sibling finish. This target uses synthetic sessions and requires no linked account.

- **Offline runner.** Check the selected Lima instance, host loopback coordinator port and matching pairing directories. Start one relay per simultaneous turn on the selected provider route. A guest login failure and an unavailable relay require different recovery.
- **Browser fails to start.** `browser-policy.sh` installs the packaged Chromium seccomp policy in the guest directory. The worker needs a writable temporary profile and enough PID and memory capacity.
- **A web request returns 403.** `X-Bench-Refusal` names the reason. Public pages are off unless the turn's sealed setting turns them on. A protected hostname that fails to resolve refuses public hosts for the rest of the turn; check `INTAKE_AGENT_PROTECTED_ORIGINS`.
- **Interrupted turn.** Preserve the original lineage, attempt and journal. Only an exact terminal record or, for a cancelled tool turn, a matching worker-removal receipt can settle the bridge recovery check. Restart the matching relay and inspect the retained attempt. Preserve uncertain slots through the application's interruption workflow.
- **Credential management unavailable.** Restore the management tunnel and check configuration status. Explicitly repeat a credential change only after checking its acknowledged revision. For ChatGPT, enable device-code sign-in in the operator's security settings and start a fresh challenge after an expired or denied one.

The qualification exercises two simultaneous controlled turns on each installation. The configured worker ceilings are 640 MiB for the tool worker, 256 MiB for its paired supervisor and 64 MiB for its provider tunnel. Chromium shares the worker's 128-task limit. VM memory and deployment load determine available headroom for real sessions. The physical qualification measurements and tested image identities are recorded on the deployment PR.

### Evidence delivery mode

Set `INTAKE_VM_EVIDENCE_DELIVERY=file` in the development environment to return temporary file paths instead of inline images from `fetch_evidence` inside tool-capable VM sessions. Restart `pnpm dev` to apply it; the managed launcher refreshes an outdated runner image. For manually managed installations, rebuild/load the runner image and set the variable on each tool-capable provider relay before restarting those relays. An existing turn keeps its selected mode.

File delivery is the default, including for an empty value. Explicit `inline` keeps the inline image and local file. Other values are refused. Both Claude and Codex receive the setting. Tool-less and direct native sessions retain their existing delivery. This setting controls representation, not evidence permission or image budgets.

File mode verifies and saves the same image bytes and returns citation metadata and a local path, with instructions to open it through the provider's image/file tool. The path lasts only for that turn; a later turn must fetch again. Photo-view history still means prepared for delivery, not confirmed visual inspection. File mode avoids base64 image data in the fetch response; it does not change transport limits or guarantee every provider image-view notification fits them.

Set `INTAKE_VM_EVIDENCE_IMAGE=original` in the development environment or the deployed coordinator environment to send whole JPEG and PNG photos byte for byte, including embedded metadata. The default is `preview`. Restart the coordinator to apply. Both settings support file and inline delivery. An original exceeding the remaining 8 MiB run budget returns metadata only. Regions and PDF pages use the bounded preview.
