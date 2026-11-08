# Implementation notes

Bundle A has started with a disposable ARM64 deployment database fixture.

## Open items

Physical M1/Pi qualification, image publication conditions, real provider entitlement and Pi concurrency remain tracked in tasks 1 and 4. The installed Codex 0.166.0 protocol schema includes chatgptDeviceCode request and response variants. Live login and persistence still require testing in the guest.

Pi qualification is paused at the operator's request until dedicated SSD storage is installed. The Mac packaging fixture uses an offline guest until the bridge and egress policy are available. Chromium requires namespace syscalls and chroot in the browser's nested user namespace. The packaged smoke test retains the browser sandbox, a non-root user, no-new-privileges and an empty container capability set.

The M1 qualification needed a verified local copy of the pinned Alpine download and a VM restart after first-boot SSH disconnected. Docker Desktop's classic image store and the guest's containerd store report different image ID types after save/load. Every ordered root filesystem layer digest matched. Carry the OCI manifest digest separately when preparing release artifacts.
