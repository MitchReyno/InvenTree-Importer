# InvenTree Importer workspace

This repository contains the `invimport` Python importer and Bench Intake, the local application for capturing photos, proposing lots and reviewing inventory changes. From the repository root, [`pnpm dev`](#run-the-full-local-setup) runs that application on this machine. The importer stays the `invimport` CLI. Live model calls are a separate opt-in, through a native agent or the [VM agent runner](#vm-agent-runner).

| Start here                                      | Responsibility                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Backend README](backend/README.md)             | Python install/configuration, CLI/library usage, imports, synthetic demo, scanner and operational limits |
| [Frontend README](frontend/README.md)           | Scaffold setup, development, checks and current/future scope                                             |
| [Intake server README](intake-server/README.md) | Executable bootstrap, exact contracts/SQL, testing tiers and owned local service ledger                  |
| [Shared architecture](ARCHITECTURE.md)          | Cross-application map, ownership and implemented boundaries                                              |
| [Shared code guidelines](CODE_GUIDELINES.md)    | Cross-language engineering, effects, validation and review                                               |
| [Repository layout](docs/repository-layout.md)  | Runtime paths, local data and source/installed-wheel behavior                                            |
| [AGENTS.md](AGENTS.md)                          | Project workflow, mirrored skills/agents and required checks                                             |

## Layout and toolchains

```text
backend/       uv-managed Python package, config, scripts and tests
frontend/      React + TypeScript + Vite application and component tests
intake-server/ Fastify + PostgreSQL foundation, no product executor
contracts/     runtime schemas and generated OpenAPI/DTO/client
media-decoder/ decoder program run inside the pinned media container
docs/          operator and design documents
.agents/       mirrored project skills
.claude/       mirrored skills and Claude agents
.codex/        corresponding Codex agents
```

Applications have owning READMEs and architecture; backend, frontend and intake server have their own code guidelines, and intake adds [testing guidelines](intake-server/TESTING.md). Shared guidance, CI, root pnpm control and documentation remain at repository root. Node dependencies/scripts live in their packages; root owns one pnpm lockfile. Python retains its own backend uv lock and package identity. Use Python 3.12/uv and the Node/pnpm pins in `.node-version` and root `package.json`; follow each app README for installation.

## Run the full local setup

Run these commands from the repository root. `pnpm dev` starts Bench Intake at **<http://127.0.0.1:4330>**: the UI, API, apply worker, media decoder, Processing worker and a persistent fake inventory. PostgreSQL and the decoder run in Docker. Ctrl-C stops those processes and keeps the database and app data. Targets, tailnet access, reload and native agents are documented in [local app development](docs/development.md).

### Requirements

- Node from `.node-version` and pnpm from the root `packageManager` field.
- Docker, with Compose 2.24 or later, for the shared database and the decoder image.
- Python 3.12 and [uv](https://docs.astral.sh/uv/), for the importer CLI and the commit hooks.

The VM agent runner also needs an Apple Silicon Mac, Lima 2.3 or later, and `limactl` on `PATH`. It uses a separate aarch64 Linux VM with its own Docker engine. Raspberry Pi and packaged-host installs are in the [deployment guide](tooling/deployment/README.md).

### Install

```sh
pnpm install --frozen-lockfile
uv sync --project backend --locked
```

Leave an existing root `.env` in place and merge the settings from `.env.intake.example` into it. When the checkout has no `.env`, copy the example:

```sh
cp .env.intake.example .env
```

`.env` stays gitignored. The launcher reads it once at startup. Shell values win, including empty ones. The file is parsed as data, so write absolute paths and literal values. Restart `pnpm dev` after an edit.

The copied example selects the mock inventory and scripted agents. That start needs no vendor, inventory or model credentials.

### Start the app

Start Docker, then:

```sh
pnpm dev
```

Open <http://127.0.0.1:4330>. The first start builds the decoder image and creates a private namespace under `~/.local/state/bench-intake`. By default, scripted agents show source-bound proposals and make no model calls, against a built-in mock inventory. Switches in `.env` choose the inventory, read-only access and real agents; see [choosing what the app runs](docs/development.md#choosing-what-the-app-runs).

`pnpm dev --tailscale` also serves the app over HTTPS on this machine's tailnet. `pnpm inventree:dev up` starts a seeded local InvenTree at <http://127.0.0.1:4320>; set `INTAKE_USE_LOCAL_INVENTREE=true` in `.env` before `pnpm dev` to read from it. Both are covered in [local app development](docs/development.md).

### VM agent runner

Use this when a Processing session should run Claude or Codex inside the shared VM. `pnpm dev` runs the session coordinator from this checkout. The relay and the provider CLIs run in the Lima VM, from a private runner image. Subscription tokens and the operator key are entered in the app.

Keep the build, VM, pairing and provision commands in one shell so the variables stay set. Each relay and each SSH forward runs in its own terminal; export the variables again there before pasting the command.

Build the images in the Mac Docker context. These tags are local names for this checkout; keep the personal image private, because it contains the provider CLIs.

```sh
export INTAKE_APP_IMAGE=bench-intake-app:dev
export INTAKE_GUEST_IMAGE=bench-intake-personal-guest:dev
export INTAKE_RUNNER_IMAGE=bench-intake-runner:personal
docker buildx build --load --platform linux/arm64 \
  -f tooling/deployment/images/app.Dockerfile -t "$INTAKE_APP_IMAGE" .
docker buildx build --load --platform linux/arm64 \
  -t "$INTAKE_GUEST_IMAGE" tooling/deployment/guest
docker build --platform linux/arm64 \
  --build-arg APP_IMAGE="$INTAKE_APP_IMAGE" \
  --build-arg PERSONAL_TOOLS_IMAGE="$INTAKE_GUEST_IMAGE" \
  -f tooling/deployment/images/runner.Dockerfile --target personal \
  -t "$INTAKE_RUNNER_IMAGE" .
```

Create the VM and load the runner into the guest Docker engine. `bench-agent-m1` can be any name of lowercase letters, digits and hyphens.

```sh
vm=bench-agent-m1
limactl start --tty=false --vm-type=vz --name="$vm" tooling/deployment/lima/agent.yaml
docker save "$INTAKE_RUNNER_IMAGE" | limactl shell --workdir=/ "$vm" sudo docker load
```

If the first SSH connection drops during provisioning, check `limactl list` and start that VM again. Confirm Docker is running inside the VM before the next step.

Pair the coordinator and the guest once. Both directories must be new, and the host directory's parent must already exist. The first `pnpm dev` creates `~/.local/state/bench-intake`. The host directory is an absolute path outside this checkout. The guest directory is an absolute path inside the VM, and may contain only letters, digits, `_`, `.`, `/` and `-`.

```sh
export INTAKE_VM_PAIR="$HOME/.local/state/bench-intake/vm-pair"
guest_directory=$(limactl shell --workdir=/ "$vm" sh -c 'printf %s "$HOME/bench-intake-guest"')
tooling/deployment/bridge/pair.sh "$vm" "$INTAKE_VM_PAIR" "$guest_directory"
```

Provision the guest services once, for the exact browser origin. The default app origin is `http://127.0.0.1:4330`. A different `INTAKE_DEV_PORT`, or the tailnet address, is a different origin and needs its own provision. The Claude command creates the operator key file when it is missing.

```sh
umask 077
origin=http://127.0.0.1:4330
operator_key_file="$HOME/.local/state/bench-intake/vm-operator-key"
tooling/deployment/bridge/personal-claude.sh \
  "$vm" "$guest_directory" "$INTAKE_RUNNER_IMAGE" "$operator_key_file" "$origin"
tooling/deployment/bridge/personal-codex.sh \
  "$vm" "$guest_directory" "$INTAKE_RUNNER_IMAGE" "$origin" "$operator_key_file"
```

Publish the guest document-reader policy. This command exits after the reader is up.

```sh
export INTAKE_VM_PORT=14313
bash tooling/deployment/bridge/public-web.sh "$vm" "$guest_directory" "$INTAKE_RUNNER_IMAGE"
```

Start one relay per provider, each in its own terminal. A relay handles one turn at a time and keeps running. It retries until the coordinator is listening, so it can start before `pnpm dev`. Export the variables in that terminal first:

```sh
vm=bench-agent-m1
export INTAKE_RUNNER_IMAGE=bench-intake-runner:personal
export INTAKE_VM_PORT=14313
guest_directory=$(limactl shell --workdir=/ "$vm" sh -c 'printf %s "$HOME/bench-intake-guest"')
```

```sh
INTAKE_VM_BUILTIN_TOOLS=1 INTAKE_VM_CLAUDE_SUBSCRIPTION=1 \
  node tooling/deployment/bridge/relay.mjs \
  "$vm" "$INTAKE_VM_PORT" "$guest_directory" "$INTAKE_RUNNER_IMAGE"
```

```sh
INTAKE_VM_BUILTIN_TOOLS=1 INTAKE_VM_CODEX_SUBSCRIPTION=1 \
  node tooling/deployment/bridge/relay.mjs \
  "$vm" "$INTAKE_VM_PORT" "$guest_directory" "$INTAKE_RUNNER_IMAGE"
```

Use another free loopback port when `14313` is already taken, and use that same port in `.env` and in both relays. `INTAKE_VM_WEB_MODE=public` on the reader command allows general public HTTPS reads. With that mode, set `INTAKE_VM_PROTECTED_HOSTS` to every public hostname of this app, the inventory server and this machine. The default reader allows RFC Editor, Python documentation and Example Domain. Details and limits are in the [deployment guide](tooling/deployment/README.md#shared-vm-sessions-with-native-tools).

`shared-vm-agent/1` is the same VM with one guest turn and no tool worker; select it with `INTAKE_VM_AGENT_TOOLS=false`. For that profile, skip `public-web.sh` and start each relay without `INTAKE_VM_BUILTIN_TOOLS=1`.

While signing in, forward the guest management ports to this machine, one forward in each terminal. Export `vm` there the same way. Keep the forwards open while the settings panels are in use. `ControlPath=none` gives each forward its own connection; through Lima's shared one, `ssh` would hand the forward over and exit.

```sh
ssh -NT -o ExitOnForwardFailure=yes -o ControlPath=none -F "${LIMA_HOME:-$HOME/.lima}/$vm/ssh.config" \
  -L 127.0.0.1:14315:127.0.0.1:14315 "lima-$vm"
```

```sh
ssh -NT -o ExitOnForwardFailure=yes -o ControlPath=none -F "${LIMA_HOME:-$HOME/.lima}/$vm/ssh.config" \
  -L 127.0.0.1:14317:127.0.0.1:14317 "lima-$vm"
```

Add the runner settings to `.env`. Paste the absolute host directory from `INTAKE_VM_PAIR`; a `$HOME` value in the file stays literal.

```dotenv
INTAKE_USE_MOCK_AI_AGENTS=false
INTAKE_RUN_AGENTS_IN_VM=true
INTAKE_VM_PAIR=<absolute host directory>
INTAKE_VM_PORT=14313
```

Stop a running `pnpm dev`, then start it again so it reads the file. In **Settings › Agents → Personal Claude subscription**, enter the operator key, choose **Check configuration**, then paste a token from `claude setup-token` and save it. The token stays out of `.env`. [Claude Code authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token) describes that command. In **Settings › Agents → ChatGPT subscription**, enter the same key and choose **Sign in with ChatGPT**. Enable device-code sign-in in [ChatGPT security settings](https://chatgpt.com/#settings/Security) first. Choose **Claude** or **Codex**, **Subscription**, and a model, then start a new Processing session.

The guest egress service has to be running during inference. Claude credential management can be offline after a saved token. Rebuilding the runner image is required after a change to guest or provider code, followed by `docker save` and `docker load` into the same VM. `pnpm dev` reloads the coordinator from this checkout.

On a later day, start the same VM, export the same variables, then start the same tunnels and relays and run `pnpm dev`. Alternatively, add `INTAKE_VM_NAME`, `INTAKE_VM_GUEST_DIR` and `INTAKE_VM_RUNNER_IMAGE` to `.env`, and `pnpm dev` starts the VM, tunnels and relays itself and stops them with the app; see [running the agent VM with the app](docs/development.md#running-the-agent-vm-with-the-app). Leave the pairing directories and the operator key file in place. `limactl stop "$vm"` pauses the VM and keeps its disk.

```sh
limactl start "$vm"
```

## Root commands

After installing the application toolchains/dependencies as described in their READMEs, run from repository root:

```sh
pnpm dev                  # full retained local app at 127.0.0.1:4330
pnpm codex:login          # Codex subscription login for this dev app's private home
pnpm dev:ui               # standalone frontend development server
pnpm build                # frontend production assets
pnpm typecheck
pnpm lint                 # Python, frontend and Markdown
pnpm test                 # normal backend, frontend and fast intake tests
pnpm dev:intake            # standalone API with source-only reload; no workers
pnpm typecheck:intake      # contracts, media-decoder and intake-server
pnpm contracts:check       # generated OpenAPI/DTO/client drift
pnpm db:intake test        # explicit owned local PostgreSQL qualification
pnpm db:intake test:process # explicit synthetic DBOS process qualification
pnpm backend --help        # unchanged invimport CLI
pnpm demo --help           # synthetic loopback demonstration commands
pnpm workflow-sync        # mirrored skill/agent consistency
pnpm test:scanner         # scanner extra and scanner/TUI suite
pnpm test:all              # normal/scanner, frontend and fast intake suites
```

`pnpm dev` is the local application above. The other root scripts delegate to one application boundary. The [backend guide](backend/README.md) documents explicit import approvals and limits.

Root `.env`, `.local_imports/`, caches and existing execution/scanner state are not moved or reset. Explicit relative arguments keep caller-cwd meaning. Read the [layout guide](docs/repository-layout.md) before running commands from another cwd or supplying state/config overrides. The default mock inventory and scripted agents need no vendor or inventory credentials.

## Commit hooks and CI

After `uv sync --project backend --locked` and `pnpm install --frozen-lockfile`, opt in to the local hook with `pnpm hooks:install`. Hooks check staged files for merge conflicts, JSON/TOML/YAML syntax and large added files, format changed web/code files with Prettier, format and lint changed Python with Ruff, run ESLint when frontend code changes, and format/lint changed Markdown with remark. They do not run tests, builds or typechecks. Toolchain executables must be on PATH when committing. Installation is explicit because Git worktrees share a hooks directory; installing in one worktree affects commits in the others too.

Formatters can rewrite working files and cause the hook to fail with “files were modified”; inspect the diff, explicitly stage the intended changes, then retry. Hooks never `git add` for you. Pre-commit temporarily stashes unstaged edits and restores them; conflicting unstaged edits can cause it to roll back formatter fixes. Keep that output visible and resolve deliberately rather than silently staging the whole file. Use `pnpm hooks:check` for all tracked files only when you intend a broad check: it can rewrite legacy Python and Markdown. Routine commits enforce formatting on changed files, not a claim that all legacy files already comply.

### Formatting in CLI and VS Code

Open the **repository root** in VS Code, install the recommended **Prettier – Code formatter** (`esbenp.prettier-vscode`), **ESLint** (`dbaeumer.vscode-eslint`) and **Ruff** (`charliermarsh.ruff`) extensions (Cursor uses the same ones), trust the workspace, and install dependencies with the commands above. Workspace settings select the locally pinned tools and enable format-on-save for JavaScript/JSX (including CJS/MJS), TypeScript/TSX (including CTS/MTS), JSON/JSONC, CSS and Python. Recommendations do not auto-install extensions; missing extensions/dependencies, an untrusted workspace or overriding editor settings can prevent formatting. Ruff paths cover the normal uv environment on Unix and Windows; custom `UV_PROJECT_ENVIRONMENT` users must point their editor's Ruff path at that environment. No global user settings are changed.

The ESLint extension uses the repository's own ESLint and the `eslint.config.*` nearest each file, so it shows the ESLint problems that `pnpm lint:frontend` and `pnpm lint:readability` report. It does not run the frontend's token, contrast and literal-colour checks, which `pnpm lint:frontend` also runs.

```sh
pnpm format                          # write eligible web/code files, not Python/Markdown
pnpm format:check                    # same web/code scope, report only; nonzero on drift
pnpm exec prettier --write frontend/src/App.tsx # individual web/code paths
pnpm format:python backend/src/invimport/example.py       # use actual changed paths
pnpm format:python:check backend/src/invimport/example.py # report only
pnpm format:markdown                 # existing remark workflow, repository-wide
pnpm test:formatting                 # real CLI/hooks in disposable Git fixtures
```

Prettier's root config is shared by CLI, editor and hook: single quotes, no semicolons, 100-column preferred code width, no embedded-template formatting. `.prettierignore` allows only the listed web/code extensions and excludes backend/spikes/docs, mirrored workflow assets, generated output, vectors, fixtures, migrations and local/cache/build/worktree artifacts. This preserves original mockups/screenshots under `docs/bench-intake/reference/`, immutable SQL migrations, generated contracts and byte-sensitive evidence. It deliberately leaves fixture helper code outside Prettier too. Binary/media files are not formatter inputs. Do not use the editor's **Format Document (Forced)** to bypass ignores on preserved artifacts.

Ruff uses `backend/pyproject.toml` in CLI/editor/hook; the Python commands accept paths (without paths they scan the current directory). Formatter-specific excludes and the hook's `--force-exclude` protect evidence/generated/local-data paths without weakening lint. Existing Python is not mass-reformatted: format the files you change and inspect their mechanical diffs. This PR baselines eligible web/code sources, not every language in the repository. New preserved/generated locations must be added to the owning ignore policy before formatting them.

Markdown remains solely remark's responsibility, not Prettier's. VS Code disables Markdown format-on-save and enables soft wrapping; use the existing CLI/hook formatter. `pnpm lint:markdown` reports warnings without rewriting; `pnpm format:markdown` writes applicable Markdown. Both respect `.gitignore` and exclude local worktrees/review artifacts. Remark supports GitHub tables/task lists and keeps prose unwrapped, with no fixed line width. Existing Markdown lint findings are not bulk-fixed. HTML, YAML and SQL are not opted into code formatting; syntax hooks still check JSON/TOML/YAML. No new formatting CI gate or changes to required checks are introduced; existing generated-artifact drift checks retain their exact-byte contract.

GitHub Actions runs optional, path-aware checks on every PR and pushes to `main` / `interactive-app`. **Changed paths** always tests the selector; reusable **Test** and **Lint** jobs run only relevant application/tooling checks. Backend, frontend and intake contracts/HTTP checks remain separately visible; frontend retains its typecheck/build. Intake-only code does not select the Python importer or the currently disconnected frontend; docs-only changes select Markdown, not server/backend tests. Workspace dependencies and CI changes conservatively select their consumers. CI does not run the intake PostgreSQL/process tiers: that job is disabled because it exceeds the included free Actions minutes, and shows as skipped. Run `pnpm db:intake test` and `pnpm db:intake test:process` locally before review and record the results in the PR description. If the job is re-enabled it uses a fresh CI-only PostgreSQL service and explicit fake/sandbox settings, never Docker development credentials or root `.env`. See [testing tiers](intake-server/TESTING.md).

There is no aggregate required **CI** gate, `continue-on-error` or success-forcing job: every selected failure remains a workflow failure; unselected jobs skip natively. The coordinator removed only required status checks from repository ruleset 26298509, preserving history protection (recorded provenance in T00). Optional branch checks do not waive this initiative's review/merge process: selected relevant checks must pass before coordinator merge. Do not reinstate the obsolete required aggregate or count skips as passing coverage. No application tests run in the local pre-commit hook.

## Initiative and contributions

`interactive-app` is the user-named integration trunk for this initiative, starting from the reviewed main base. Target initiative PRs there on separate conventional feature branches. Work is planned as [OpenSpec changes](docs/openspec.md), and each PR needs a fresh independent review of its exact head and passing selected checks before it merges. No merge into main is part of this work.

Read the shared and owning app code guidelines before writing, changing or reviewing code, as [AGENTS.md](AGENTS.md#read-the-code-guidelines-first) requires, and the owning architecture before changes. Keep future product/workflow plans explicitly labeled until implemented; the file-picker scaffold is not capture/approval, and the separate intake foundation is not an inventory executor or release-qualified deployment.

Licensed under [GPLv3](LICENSE); see [third-party notices](THIRD-PARTY-NOTICES.md). DigiKey/InvenTree are their respective owners' trademarks; this independent tool is not affiliated with or endorsed by them. Vendor API obligations and credential handling are described in the [backend guide](backend/README.md#using-the-digikey-api).

[Local app development](docs/development.md) covers `.env` configuration, fake, read-only and local InvenTree targets, source reload, retained data and native Processing. The [deployment guide](tooling/deployment/README.md) covers packaged installs, image rollback and VM troubleshooting. Start from `.env.intake.example` and merge it into an existing environment file.
