# Bench Intake Stage 1A: subscription runtime — engineering handover (2026-11-01)

Task: investigate supported personal subscription routes and demonstrate bounded synthetic evidence research without inventory authority. Repository: [MitchReyno/InvenTree-Importer](https://github.com/MitchReyno/InvenTree-Importer). Tickets: none. Decisions owner: Mitch; implementation defaults below belong to the Stage 1A owner. Snapshot: 2026-11-01 04:50 UTC; refresh with `bash spikes/subscription-runtime/state.sh` from this worktree. Paths in this tracked handover are deliberately portable, overriding the handover skill's external-pack absolute-path convention.

## 1. Where things stand

| Item | State |
| --- | --- |
| `feat/spike-subscription-runtime` | Isolated owner branch from shared commit `a4e16686a4c6f563a9dc28aefd94481af5dedf77`; current HEAD is printed by the state script. |
| Initiative trunk | `interactive-app`, as directed by Mitch; Stage 0 is merged. Do not follow stale plan text saying Stage 0 is pending or target main. |
| Publication/review | No push, PR, merge or independent review by this owner. Ready for a fresh read-only reviewer, not permission to publish. Owner must fix findings and obtain clean re-review. |
| Other worktrees/owners | Preserved; coordinator owns shared contracts/root docs/publication, other owners own coordination and importer-adapter spikes. No shared files or reusable importer code changed. |
| Native sessions | Actual local Codex image/PDF-text question/continuation and cancellation; actual local Claude PNG/PDF Read and Write denial. No API key used, no credentials copied and no inventory calls. |
| Background checks | Final normal root suite exited successfully; exact results below. No owner check or provider command is intentionally left running. |

**Summary:** the local personal-host route is practically viable for both providers. Codex produced an actual importer-valid one-Part/two-lot proposal after a persisted counted-20 answer and native session resumption in a fresh process. Claude read both PNGs and the PDF through its native Read tool, asked the quantity question, and reported a denied Write with no file created. This is not complete provider parity, production containment, remote entitlement or an adversarial production runner.

## 2. The plan in one page

Read the external `intake-shared-fixtures-and-spikes` handover and its `artefacts/product.md`, `design.md` and `plan.md` in full, especially Stage 1A; they are available under `$HOME/.agents/handovers/`. Also read [shared contracts](../../spikes/shared/README.md), [runtime route record](../../spikes/subscription-runtime/README.md), current root/backend guidelines and architectures. Current user instructions supersede the snapshots: parallel spikes are authorized, own-Mac local execution is available, Stage 0 is merged, and no remote deployment, credential export, API billing fallback or live inventory effect is authorized.

The protocol is `bench-intake-spike/1`. Input revisions are SHA-256 of exact manifest bytes, not application counters or canonicalized JSON. The first revision is `d74cc96d3869139e4c1293f2bc721e24ec09902882542be4997ae37572bddf34`; counted-20 continuation is `9e63fac0e64b98ae3c8b799d69edbefa9cd86b413786a5b58060ddac3acc9dcf`. Preserve `SPIKE-TWO-LOTS-001`, shared `resistor-100r`, and distinct immutable `lot-a`/`lot-b` contribution IDs.

The owner staged only `input.json` and three hash-verified originals. Neither the expected proposal oracle nor example messages nor the confirmed answer was staged for the first turn. Trusted bounded instructions requested evidence reading and proposals only. After the real model asked for lot B's counted quantity, the supervisor committed the application question, exited the runtime, and a separate process recorded the authorized fixture answer “20”, staged the exact confirmed manifest, and resumed the same native thread. This is an authorized synthetic human-answer simulation, not a claim that a real person counted physical parts during the run.

Codex receives two real `LocalImageInput` PNGs plus text extracted locally from receipt PDF page 1 using pinned pypdf. It does **not** demonstrate native PDF attachment support. Claude receives filenames and uses native Read on both PNGs and receipt PDF. Provider results remain proposals; `validate_proposal.py`, run separately in the backend environment, checks bounded fixture domain facts/identities/evidence and calls the actual importer parser and validator before emitting `succeeded`.

## 3. Decisions, alternatives and plan adjustments

1. **Choose own-Mac local personal runner, not remote deployment** — Mitch's current owner brief, 2026-11-01; owner selected the available route after reading official docs. Remote classification remains a separate gate. No token-transfer interpretation of SIWC VM examples is used.
2. **Official Python SDK/app-server for Codex** — plan preference, implemented by owner on 2026-11-01. Spike-local `openai-codex==0.163.0` pins `openai-codex-cli-bin==0.163.0` through its lock. Installed ambient CLI is `0.166.0`, used only for safe help/status inspection, not substituted into the SDK. No bespoke JSON-RPC transport was written. The facade lacks a rate-limit helper, so a narrowly documented call through its typed official transport uses the generated response model; this private facade access is upgrade-sensitive.
3. **Unmodified Claude CLI first, not SDK product auth** — plan and user preference. Observed CLI is `2.1.316`, not the old snapshot's `2.0.31`. The live entrypoint rejects another version until deliberately re-evaluated. Safe/restricted mode, empty optional settings sources, explicit claude.ai login, no hooks, strict empty MCP and Read-only approval policy avoid bare mode's subscription-OAuth exclusion. No binary/login/global-config change was made.
4. **Explicit subscription/billing gates** — owner default. Native account status must positively identify supported subscription mode; unknown/API-key/alternate provider fails closed. Child environments are allowlisted, excluding API keys, endpoint/provider overrides, explicit OAuth tokens and custom config-home selectors. Codex requires ordinary included capacity and explicitly no paid credits/unlimited credit fallback. Native status does not establish an audited invoice or prove account extra-usage settings; see limitations.
5. **Use local deterministic PDF extraction for Codex** — owner plan adjustment. The SDK's documented input surface directly offers text and images, not a PDF-input convenience type. Retain original PDF and describe extraction honestly instead of asserting unsupported native parity or writing another protocol implementation. Claude separately proves native PDF Read.
6. **One full continuation journey on Codex; independent native media/denial probe on Claude** — owner bounded investigation choice, not a production provider selection. Avoid spending additional subscription usage duplicating every scenario. Claude continuation/cancellation parity remains untested, not assumed from documentation.
7. **Application question persistence separate from provider permission prompts** — plan requirement. Local SQLite retains questions/answers and safe correlated outer messages; it is not a competing coordinator scheduler. Human quantity answers never approve native tools. Native execution denies escalation rather than exposing approval RPCs. Process-epoch permission replay guards are exercised synthetically in a real fresh subprocess; no live pending native prompt was revived/replied after restart.
8. **Record actual generated result rather than copy the oracle** — shared fixture requirement. Actual proposal SHA is `ecb0bd329d564581179ddf22ad7e9bfe92c7f7f2556fc9fa60924ea51fe4cfd5`, distinct from the shared expected proposal. Importer validation passes with two supplier-without-SKU warnings, retained verbatim. No SKU/manufacturer/MPN was fabricated to suppress warnings.
9. **Do not extend production importer or root manifests** — current ownership instruction. All runtime dependencies live under the spike's manifest/lock, importer use is offline, and ordinary backend tests load spike helpers without installing provider packages. No shared changes are necessary for this evidence. Coordinator may link the new spike/update Stage 1D decisions in shared docs after review.

Defaults not separately approved as production policy: local SQLite schema, narrow fixture actor/value allowlist, exact minimal proposal field allowlist, provider selection/model `gpt-6.1-sol`, 180-second Codex/150-second Claude probe ceilings and denial-only tool posture. The fixture-specific validator is a test boundary, not a second general importer policy implementation.

## 4. Capability matrix and observed evidence

| Capability | Codex | Claude |
| --- | --- | --- |
| Local personal native subscription route | **Observed:** managed `chatgpt`, plan `prolite`, ordinary included capacity, paid credit balance zero | **Observed:** native `claude.ai`, `firstParty`, `pro` |
| Remote/self-hosted service entitlement | **Conditional/unresolved:** managed auth excludes commercial/hosted services; SIWC requires separate route/consent/token lifecycle | **Conditional/unresolved:** native personal login is not blanket SDK/product/hosted-service permission |
| PNG evidence | **Observed:** two PNGs supplied as actual local image inputs; observations distinguish illustrations from counts | **Observed:** native Read tool calls on both PNGs |
| Receipt/PDF | **Observed:** original retained; trusted local pypdf page extraction supplied as text; **untested:** native PDF RPC input | **Observed:** native Read on receipt PDF page 1, factual receipt observations returned |
| Structured result | **Observed:** strict JSON-decoded question and later v2 proposal; actual importer validation passes | **Observed:** CLI JSON Schema structured question/observations, not a final stock proposal |
| Correlated progress | **Observed:** safe started/item progress correlated to batch/job/attempt/input revision and persisted in SQLite/JSONL | **Observed native tool summary only; untested:** full shared-envelope Claude adapter |
| Human question round trip | **Observed:** real model question persisted before waiting result; fixture answer 20 committed in new process, exact new input revision | **Observed question; untested:** durable Claude continuation |
| Process restart/session resumption | **Observed:** native thread resumed from opaque ID in separate processes for answer and cancellation | **Untested:** CLI resume behavior; documented, not exercised |
| Denied tool | **Observed policy:** deny-all escalation, shell/tools minimized; **untested:** native Codex pending approval callback | **Observed:** Write request denied; `permission_denials=[Write]`, denied file absent |
| Cancellation | **Observed:** explicit SDK interrupt after live start event, terminal `interrupted` | **Untested:** signal/cancel integration |
| Stale permission after restart | **Synthetic control:** real subprocess rejects old epoch/request ID; no live approval channel exposed | **Policy:** nobody answers native prompts; **untested:** live pending prompt/restart/reply scenario |
| Quota/login/errors | **Observed:** logged-in/capacity-safe preflight; **synthetic:** missing auth, other billing mode, exhausted/unknown capacity, typed failure categories | **Observed:** logged-in preflight; **synthetic:** login/alternate mode/failure categories |
| Web search/local MCP/hosted tools | **Untested/disabled:** no research tool parity claim; SIWC hosted exclusions are documented only | **Untested/disabled:** no web/MCP/connector claim |
| Inventory writes/API fallback | **Unsupported by spike:** no inventory tool or key provided, no paid API route | **Unsupported by spike:** Read/denied Write only, no inventory credentials or API fallback |

Tracked evidence under `spikes/subscription-runtime/observed/` contains actual final response objects, the generated proposal, importer validation report, safe correlated outer messages and Claude tool/denial summary. It deliberately excludes raw provider streams, private reasoning, account/email identifiers, host paths, credential stores and full native session files. One opaque Claude session ID is retained as permitted native correlation, not a credential. Originals remain committed under `spikes/shared/fixtures/two-lots/evidence/` with matching input hashes; ignored owned local workspaces also retain exact copies. Tests reconstruct the proposal workspace from those originals, not the oracle.

## 5. Verification and exact reviewer commands

Run from repository root with declared toolchains (Python 3.12, uv; pinned Node/pnpm for root suite). Offline checks never invoke provider inference:

```sh
uv sync --project backend --locked
uv sync --project spikes/subscription-runtime --locked
uv run --project backend pytest backend/tests/spikes/test_subscription_runtime.py
uv run --project backend ruff check --config backend/pyproject.toml spikes/subscription-runtime backend/tests/spikes/test_subscription_runtime.py
pnpm install --frozen-lockfile
pnpm test
git diff --check
bash spikes/subscription-runtime/state.sh
```

Focused check: **38 passed**, including actual retained proposal/importer compatibility, observed message schema/sequence/hash conformance, staging without oracle, symlink/traversal/tamper rejection, duplicate-key/nonfinite decoding, persisted-answer acceptance/duplicate terminal rejection, invented data rejection and synthetic auth/credit/quota/error cases. Fresh-process SQLite test uses an actual child process to check question retention and rejection of synthetic old permission identity. Ruff: **passed** on all owner Python files. Initial focused check was 33 passed before five acceptance controls were added; the later 38-test run supersedes it. No scanner/TUI, skill or agent behavior changed.

Normal root suite: final `pnpm test` **passed**: frontend **2 passed**; backend **1981 passed, 1 skipped, 43 deselected**, 233.74 seconds. This final run includes all 38 owner tests and supersedes an earlier passing 1976-test run collected before five acceptance controls were added. Frozen offline installation succeeded with the pinned Node/pnpm and existing package store, without modifying root/backend manifests or locks. No code or test edits followed the final collection; only this handover was updated with results.

Actual live commands already executed with the user's explicit bounded personal-session authorization:

```sh
uv run --project spikes/subscription-runtime python spikes/subscription-runtime/live_codex.py start spikes/subscription-runtime/local/codex-1
uv run --project spikes/subscription-runtime python spikes/subscription-runtime/live_codex.py continue spikes/subscription-runtime/local/codex-1
uv run --project spikes/subscription-runtime python spikes/subscription-runtime/live_codex.py cancel spikes/subscription-runtime/local/codex-1
uv run --project backend python spikes/subscription-runtime/live_claude.py spikes/subscription-runtime/local/claude-1
uv run --project backend python spikes/subscription-runtime/validate_proposal.py spikes/subscription-runtime/local/codex-1
```

Do **not** blindly rerun those commands against retained state. `start` refuses existing directories; `continue` is one-shot, answers a specific question, and rejects duplicates; final acceptance refuses an already-terminal attempt. Use a fresh owned local directory for another authorized run and inspect failures first. Subscription inference is deliberately excluded from ordinary tests. The outer retained success was emitted only after real importer validation, not on provider completion. Subsequent stricter fixture validation is covered offline with the retained actual output.

## 6. Process and independent review

The owner implemented and self-checked only owned files. The coordinator schedules the fresh independent reviewer, owns shared-contract changes and eventual publication. Review the actual diff from `a4e1668`, this handover, retained evidence and limitations; ordinary tests do not establish provider facts beyond those actual observations. Fix all material findings, update this handover with exact reviewed hashes/evidence, and obtain clean re-review before any PR. No independent approval is claimed yet. Conventional commits only; target initiative work to `interactive-app`, never main.

## 7. Hard rules

- Preserve every other worktree, all local inventory data and others' changes. Never reset/clean or migrate user data; do not manipulate another owner's jobs.
- Owner scope is `spikes/subscription-runtime/**`, `backend/tests/spikes/test_subscription_runtime*.py`, and this tracked handover. Ask coordinator before changing shared contracts, importer code, package roots, root docs or root/backend dependency manifests.
- Never read/copy/export personal credential stores or keychain contents, obtain setup tokens, change login/global configuration, or expose raw native runtime endpoints. Safe native status is allowed; retain only deliberately allowlisted status fields.
- Never pass paid API keys or use hidden API/provider fallback. Missing/unknown mode or capacity fails closed. Do not induce real quota exhaustion or redeem free resets just for a test.
- Never stage `expected-stock.json` or the example success transcript in a real provider workspace. Never renumber physical contribution IDs. Keep original bytes and exact revisions.
- No live inventory writes, PR, push, merge, new agents/threads for implementation delegation or remote deployment are authorized to this owner. Native provider sessions were created only for the explicitly requested fixture experiment, not to delegate repository work.

## 8. Gotchas, limitations and unresolved gates

- **Early interrupt failed:** the first eager interrupt immediately after `turn/start` returned `InvalidRequestError`. Its outer attempt remains incomplete in retained history. A subsequent native thread read reported that turn interrupted after client shutdown; that is not claimed as successful explicit cancellation. Waiting for the first live start/item event before calling SDK interrupt then produced a confirmed terminal `interrupted` on a distinct attempt. Do not overwrite the failed observation or reuse its attempt ID.
- **SDK Account is a root model:** an early safe probe incorrectly accessed `.account.type`; it raised `AttributeError` with no inference. The final code uses generated `model_dump(by_alias=True)` and a safe summary. Do not log the full account/rate-limit response, which includes personal/opaque account metadata even though it contains no raw credentials.
- **Not production containment:** these are trusted, authored synthetic fixtures and native runtime permission policies, not a hardened adversarial multi-user sandbox. Codex read-only sandbox is not a deny-read boundary for the whole host; disabled shell/hooks/apps/agents and bounded instructions reduce available tools but do not establish universal credential-file containment. Empty MCP map override behavior across arbitrary inherited global/managed configurations has not been audited. A production runner needs verified effective-tool inventory and filesystem/network isolation without credential copying.
- **No universal crash-safe supervisor:** SQLite question commits are durable, but session hints/artifact files are one-shot local probe outputs, not multi-file atomic transactions. A crash between answer commit, manifest publication, provider invocation or success export needs inspection, not automatic retry. Duplicate dispatch/concurrent acceptance, transactional outbox, current-attempt ownership and product authentication belong to Stage 1B/application work. No generic recovery guarantee is claimed.
- **Inference-time failures are not a completed typed adapter:** controlled category mapping is regression-tested synthetically; the current live Codex script uses safe generic failure on unexpected stream/runtime errors rather than proving every vendor quota/login error taxonomy. Preflight login/capacity gates are implemented. Wire production error events deliberately before claiming full state parity.
- **Permission restart acceptance is partial:** a synthetic pending permission identity is rejected after a real fresh process, and live policy never accepts native permission replies. A live native pending-approval/restart/stale-reply experiment is still untested. Do not relabel the synthetic guard as native-provider evidence.
- **Billing evidence is mode/capacity evidence:** Claude Pro login plus explicit native-only configuration avoids API-key routing, but the spike did not inspect or change account extra-usage settings or audit a bill. Codex positively reported no paid credits at each tested turn gate; no inference budget claim across concurrent external account changes is established. A stricter no-overage deployment policy needs provider-supported account-side controls before production.
- **No general OCR quality claim:** the manifest already contains structured fixture facts; actual image observations and native Read calls prove media paths, not unsupervised identification accuracy on arbitrary worn components. Search/research, image manipulation, native PDF parity and hostile-evidence tool escalation are separate tests.
- **No rg executable in this shell:** attempted `rg` was unavailable; targeted file reads/package inspection used known paths and bounded standard tools, without installing/changing global tools.
- **Toolchain:** default shell Node was 22, while root requires pinned 24/pnpm 12. Existing task tool binaries were prepended for installation/tests; no global upgrade occurred. Portable repository commands assume the declared versions are on PATH.

## 9. Open items needing a human/coordinator

| Item | Owner | Gates |
| --- | --- | --- |
| Independent review and findings loop | Coordinator + Stage 1A owner | PR publication; no approval claimed yet |
| Exact remote/personal self-hosted UI classification and SIWC ownership if chosen | Mitch/provider | Any remote deployment; current proof is local Mac only |
| Account-side no-overage guarantee/operational billing policy | Mitch/provider | Strict production no-extra-usage guarantee; never silently substitute API keys |
| Choose first production provider and required parity tests | Mitch/coordinator, informed by matrix | Stage 1D/3; do not infer complete parity |
| Live pending native permission/restart/stale reply test and effective-tool containment | Next runtime owner after reviewed route | Full Stage 1A acceptance/production runner safety claim |

No missing login/entitlement blocked the actual local runs. Remaining items must not stall the other two parallel spikes. No shared schema/importer changes were requested or made.

## 10. Locations and transfer checklist

- This worktree: runtime-discovered checkout on `feat/spike-subscription-runtime`; refresh exact HEAD/status/worktrees with `bash spikes/subscription-runtime/state.sh`. Do not operate on another checkout merely because it is listed.
- Code: `spikes/subscription-runtime/runtime.py`, `live_codex.py`, `live_claude.py`, `validate_proposal.py`; spike-only `pyproject.toml`/`uv.lock`; offline tests `backend/tests/spikes/test_subscription_runtime.py`.
- Evidence: `spikes/subscription-runtime/observed/`; committed originals/config `spikes/shared/fixtures/two-lots/`; shared schema `spikes/shared/schemas/message.schema.json`. Ignored owned `spikes/subscription-runtime/local/codex-1/` and `local/claude-1/` retain local SQLite/session hints/evidence, not portable credentials. Preserve them for inspection, never copy native personal auth directories.
- External docs: current official URLs in the spike README; full external planning pack under `$HOME/.agents/handovers/intake-shared-fixtures-and-spikes/`. No Notion edits or persistent-memory writes were made.
- Transfer first action: read this handover, run state script, inspect diff and run offline focused tests/ruff. Do not infer a passing review from owner verification. Reviewer should especially assess whether documented partial gates are correctly represented rather than treating this as production-complete.

## 11. Next steps

1. Coordinator assigns a fresh independent read-only reviewer to this exact owner branch/diff; first refresh state and run the offline checks. Gate: preserve all other worktrees and do not launch fresh paid or subscription inference merely to review retained output.
2. Owner addresses every material finding and updates the reviewed candidate/evidence here. Gate: obtain a fresh clean re-review before publication; current owner verification is not independent clearance.
3. Reconcile Stage 1D with the other spikes using the observed/synthetic/conditional/unsupported/untested matrix. Gate: coordinator owns shared schema/root architecture/plan edits; no shared changes are needed to consume this spike's current proposal and messages.
4. Resolve account-side overage controls, remote classification and effective-tool isolation before a production runner. Gate: local own-Mac observations do not grant remote deployment or API fallback permission.
5. If full native stale-permission parity is required for Stage 1A exit, add a bounded live pending-prompt/restart test through supported official interfaces and repeat independent review. Gate: no credential copying, no actual dangerous tool effect and no synthetic-to-observed relabeling.

## 12. Skills to use

Use **reviewing-code** for the fresh read-only review; **handover** for a complete transfer; **github-pr-tools** only when the coordinator authorizes publication/context operations; **planning-work** when reconciling Stage 1D. Use OpenAI docs MCP for current Codex route/auth facts (the named openai-docs skill is not installed here). If unavailable, perform the same capability directly without changing the safety gates. The handover skill's external-pack layout checker is not applicable to this explicitly requested tracked portable engineering document; required content sections, links, state script and portable-path/secret checks are verified directly.
