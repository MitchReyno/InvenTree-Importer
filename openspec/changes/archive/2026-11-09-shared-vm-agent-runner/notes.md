# Implementation notes

Bundle A has started with a disposable ARM64 deployment database fixture.

## Implementation history

Physical M1/Pi qualification, image publication conditions, real provider entitlement and Pi concurrency remain tracked in tasks 1 and 4. The installed Codex 0.166.0 protocol schema includes chatgptDeviceCode request and response variants. Live login and persistence still require testing in the guest.

Pi qualification is paused at the operator's request until dedicated SSD storage is installed. The Mac packaging fixture uses an offline guest until the bridge and egress policy are available. Chromium requires namespace syscalls and chroot in the browser's nested user namespace. The packaged smoke test retains the browser sandbox, a non-root user, no-new-privileges and an empty container capability set.

The M1 qualification needed a verified local copy of the pinned Alpine download and a VM restart after first-boot SSH disconnected. Docker Desktop's classic image store and the guest's containerd store report different image ID types after save/load. Every ordered root filesystem layer digest matched. Carry the OCI manifest digest separately when preparing release artifacts.

The operator migrated the Pi root filesystem to NVMe. The earlier SSD hold is resolved. Physical qualification uses QEMU/KVM with user-local Lima, Debian AArch64 firmware and ipxe-qemu ROMs. The Pi also needed a guest restart after its first-boot SSH disconnection. Synthetic packaging checks exercise the private host project and shared guest; end-to-end agent dispatch and provider inference remain separate tasks.

Two simultaneous offline Chromium workloads hit the fixture's 192-task cgroup cap. The tools container now has a 384-task cap and the smoke test bounds each browser invocation. Selecting a supported concurrent agent-session count still requires testing the supervisor and provider processes together.

Bundle B now includes an opt-in shared VM profile with a guest-initiated mutual-TLS channel carried over Lima stdio. Qualification uses a fresh process container per turn inside the persistent VM, with a shared guest volume for resume. This bounds each process tree without exposing the guest engine to the provider. The first vertical slice keeps the existing provider admission policy and offline network. A controlled provider tests the normal worker entry point, separate from any live inference. A disconnected dispatched turn retains its host slot; automatic reattachment/reconciliation, richer guest tools and scoped public egress remain open.

The Pi accepted the app and controlled runner image transfers, then SSH signing for the operator's Pi key became unavailable before the dispatch harness could be uploaded. Physical Pi dispatch qualification remains open until access returns. Use a decoder built from the current checkout for the PG/process suites; the previously cached media image uses an incompatible result format.

The Pi SSH key became available and the packaged offline dispatch qualification subsequently passed on the Pi. Subscription inference remains open.

The operator clarified that the setup token belongs to the sole operator of this personal deployment. Anthropic documents `claude setup-token` for unattended runs of Claude Code. Agent Settings sends explicit credential operations to the private guest management service using a separate operator key and the configured same origin. This implementation uses an SSH tunnel to guest loopback instead of relaying the token through the intake API. Ordinary guest relays keep their offline configuration. A separate Claude subscription relay mounts its private credential directory read-only and forwards CONNECT only to the Anthropic model endpoint. The OpenSpec's personal deployment scope applies. [Claude Code authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)

An actual research turn can finish its provider call and settle in `waiting_input` after opening a processing question. The live check accepts that state only with a retained open question and a reported Claude Haiku model.

The first M1 device challenge remained pending after OpenAI's verification page displayed an HTML/JSON parsing error. The operator found the device-code sign-in toggle disabled in ChatGPT Security Settings. A newly issued challenge after enabling the toggle supersedes the earlier login. The settings panel now surfaces this prerequisite before sign-in.

The earlier relay co-located the CLI with the pairing identity and journal. Tool-capable turns now use a separate guest container and a new sealed profile. Anonymous public web reads use a validating HTTPS document service on a guest Unix socket. Interactive browser navigation, delivery of original evidence bytes to a safe guest path, and two-host lifecycle qualification remain open. The Pi tool fixture used synthetic data and no provider account.

The two-host release check exposed a Docker storage-backend difference. On the Pi host, image inspect returns the OCI manifest digest as the image ID. Docker Desktop on the M1 returns the image configuration digest for the same save/load transfer. The release verifier reads the selected platform's exported configuration on engines reporting the descriptor digest.

Rolling the qualification API back to an image predating the current schema resulted in `database_version_quarantined`. The replacement gate uses a compatible previous image and checks the retained marker after both rollback and forward replacement. An older schema requires the corresponding database restore.

The cancellation fixture reproduced a browser worker that ignored transport EOF and kept running in its guest container. The operator relay now terminates the unique supervisor for that connection. Its VM launcher removes the specific worker container, then writes a matching digest receipt into the supervisor-owned journal directory. The coordinator retains an uncertain slot when the launcher cannot confirm removal. The opt-in browser fixture uses the packaged Chromium seccomp profile and synthetic sessions.

A Pi synthetic dispatch failed before posting a proposal while an image import/export was competing with the fixture. Verify the release pair before starting dispatch qualification on a resource-constrained host. Record the initial failure and the result of the serialized run in the PR.
