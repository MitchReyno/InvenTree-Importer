# Subscription runtime investigation (Stage 1A)

Repository-only personal-runner spike, not a production service or deployment entitlement. Read the [owner handover](../../docs/handovers/spike-subscription-runtime.md) for observed results and remaining gates. Never expose app-server or CLI protocol streams to a browser. No inventory commands are supplied.

## Route gate, recorded before inference

On 2026-11-01 the owner read current official documentation using the OpenAI docs MCP search and live official pages. The selected host is the user's own Mac, running an owned local supervisor under the same user as the existing official runtime login. This is **not** authorization to deploy the personal login on a remote server or offer a hosted/shared service.

- **Codex managed login:** [app-server auth](https://learn.chatgpt.com/docs/app-server#auth-endpoints) permits existing local/open-source app-server integrations and explicitly excludes commercial/hosted services; the [SDK guide](https://learn.chatgpt.com/docs/codex-sdk) documents the official Python app-server client with a pinned CLI dependency. Evaluate that route locally with native `account/read`, forced ChatGPT auth and OpenAI provider, no API key or external-token login. A model catalog is not proof of entitlement. Native rate limits must positively report ordinary capacity and no available credit fallback before a turn. Do not redeem reset credits or purchase usage.
- **SIWC is separate:** [plan usage](https://developers.openai.com/siwc/token-sharing-open-source) requires app registration, consent, protected OAuth refresh/access tokens and a stable host ID. Its self-hosted VM example does not license managed app-server auth on an arbitrary remote host. Paid/remotely hosted applications are directed to an interest process. SIWC is not implemented or authorized in this spike; its [preview exclusions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) must not be represented as managed-runtime capability results.
- **Claude personal CLI:** use only the unmodified official binary under the user's own native claude.ai Pro login. [Authentication](https://code.claude.com/docs/en/authentication) documents subscription login and API-key precedence. [Personal subscription support](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says subscription-authenticated `claude -p` still draws subscription limits; linked Console API credits are a different route. [Legal conditions](https://code.claude.com/docs/en/legal-and-compliance) distinguish native end-user sign-in from collecting/intermediating subscription credentials in a third-party product. This local end-user test does not resolve remote product classification. [Bare mode](https://code.claude.com/docs/en/headless) skips OAuth; never use it for this subscription route.

Native status observed Codex `chatgpt` / `prolite` and Claude `claude.ai` / `firstParty` / `pro`. These are safe status summaries, not credentials. No personal credential files, keychain contents, raw tokens or auth caches are inspected/copied by this spike. The native runtimes retain their own credentials. No login/logout/setup-token operation or global configuration edit is allowed.

**Review correction and historical limit:** SDK `0.163.0` overlays `CodexConfig.env` onto inherited `os.environ`. The initial helper allowlist therefore did not prove a sanitized Codex spawn; earlier no-forwarding claims are withdrawn, without asserting anything about previous billing routing or charges. The corrected standalone Codex entrypoint replaces its dedicated process environment before any SDK workers start and rejects unsanitized embedded callers. An offline sentinel-parent test intercepts the actual pinned SDK Popen before native execution. It proves the current launch control synthetically, not the historical ambient state. No inference or credential inspection is authorized for this review-fix round. Retained provider evidence is unchanged.

## Reproduction

From repository root:

```sh
uv sync --project backend --locked
uv sync --project spikes/subscription-runtime --locked
uv run --project backend pytest backend/tests/spikes/test_subscription_runtime*.py backend/tests/spikes/test_shared_contracts.py
uv run --project backend ruff check --config backend/pyproject.toml spikes/subscription-runtime backend/tests/spikes/test_subscription_runtime*.py
```

These checks need no native login/inference. The actual-SDK launch test requires the spike-local environment created by the locked sync above and explicitly skips if missing; do not count that skip as launch-boundary coverage. Proposal acceptance rejects proposal/ancestor symlinks and validates/hashes one byte snapshot through the real importer parser. Claude observation acceptance requires the three staged media Read requests, a nonblank question, an explicit Write request/denial and absence of the denied file; incomplete success transcripts are inconclusive.

Historical live commands consumed subscription capacity under the explicit personal-host and fixture-inference permission then given for this investigation; **do not rerun inference during this review-fix round**. They are not part of the ordinary test suite. Live runs use a new directory under spike-local `local/`. Initial evidence staging allowlists only `input.json` and its three byte-verified originals. `expected-stock.json`, messages and confirmed answers are never initially staged. Continue only after a persisted question, using the authorized fixture answer “20 counted”. Originals are retained unchanged; proposed data is never approval.

The spike's local SQLite question/event retention is deliberately not a coordinator or lease scheduler. A synthetic pending-permission control rejects stale process epochs in a fresh subprocess; the live probes deny escalation and expose no native permission-reply interface. A live pending native prompt/restart/stale-reply experiment remains untested. Human quantity answers never become native tool approvals. Fixture-only actor/value validation is not production application authentication.
