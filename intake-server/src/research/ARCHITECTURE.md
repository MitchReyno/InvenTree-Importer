# Restricted research fixtures

This boundary implements `restricted-research-stub/1`, an additive, explicitly fixture-only profile. It never launches a native provider. Actual model usage, entitlement, multimodal support and native tool/network/credential isolation remain unqualified and disabled pending explicit authorization.

## Composition and authority

`factory.ts` composes an injected semantic inventory reader, owning media content reader, Processing attempt access and receipt repository. It receives no apply interface. The protocol adapter receives only a broker factory and an explicitly injected session factory; it receives neither database/channel authority nor inventory credentials.

`processing/research.ts` verifies the exact retained input, instructions, command, selected running attempt, dependencies, authorized capture/media scope and held actor lane. Read-only transactions end before source HTTP. Every tool checks currentness before work and before returning; source fetching checks again after DNS and before send. Removing a configured source admission invalidates an old input. Adding an admission never broadens that immutable input.

The old note-only and metadata-only profiles retain their original instruction bytes, tool policy and defaults. An old queued handler is not silently executed under the new profile. Historical compatible messages remain readable.

## Evidence and inventory

`evidence.ts` accepts only exact version/digest membership in the sealed owning media manifest. The owning content seam authorizes each private byte read. The reader checks actual size, SHA-256 and PNG/JPEG/PDF type before returning bounded base64 chunks. Literal PNG/PDF fixture bytes demonstrate transport identity, not native interpretation.

`inventory.ts` accepts exact Part/location IDs through a semantic read closure and reuses the owning capture read parser. Only canonical model, string PK and safe label are retained. Arbitrary searches, stock reads, mutations, raw API paths and credentials are unsupported in this slice. Failure is unavailable, never successful absence.

## Sources and receipts

Source discovery is deliberately narrow: the immutable manifest contains at most sixteen exact server-admitted URLs. Neither browser nor model can admit a new URL. Credentials, fragments, nondefault ports, control characters and unsupported forms are refused. Protected origins must be explicitly configured; an empty set disables source fetching.

`source-policy.ts` resolves and validates every answer for the source and protected origins. Private, reserved, mapped-private, mixed and protected-address aliases fail before send. `source-fetch.ts` connects directly to one validated public IP while retaining the approved Host and TLS server name. It sends no auth/cookies, follows no redirects and performs no retry. DNS, response and body waits are bounded and cancellation prevents late HTTP sends/results.

`receipts.ts` retains bounded exact web bytes or canonical safe inventory observations. Canonical descriptors bind actor, target/context, batch, attempt, command, immutable input and host-generated request ID. Every read checks hashes, descriptor shape, reconstructed request identity and complete scope. Receipts cannot be repaired or reassigned on read. A per-attempt audit advisory lock serializes count/byte limits; no network operation or later domain lock occurs while it is held.

The API role can select receipt evidence for retained verification; the runner can select/insert. Neither role can update, delete or truncate receipts. Public proposals expose only receipt ID and digest. Body bytes, private descriptors and channel capabilities stay out of Job DTOs.

## Lifetimes and limits

`limits.ts` declares the budgets: 32 tool calls, one concurrent call, 256 KiB frame, 2 MiB total output, 30-second session, 5-second tool/source request, 1 MiB source body, 16 receipts/4 MiB retained bytes per attempt, 96 KiB chunk and 2 MiB evidence chunks per session. Evidence originals retain the owning 20 MiB upload limit. URL, DNS-answer and protected-origin counts are bounded separately.

`broker.ts` validates strict requests, maps exact host UUID request identities to cached results and rejects changed duplicates. Cached results still require current authority. Closing cancels its lifetime and clears replay state. A late noncancelable resolver cannot resume a send; late receipt insertion can retain audit evidence but cannot select human facts or publish a result.

The protocol adapter binds exact thread/turn/call identities and constructs application envelope identity/sequence itself. Native permission and unknown tool requests fail closed; application questions never hold native permission handles. A question or terminal is emitted only after confirmed session reap. Unconfirmed reap throws a distinguished error, and Processing retains physical lane ownership. No native continuation is resumed after restart: new work requires a fresh attempt.

## Verification limits

Tests use deterministic protocol sessions, controlled Node children, owned loopback HTTP and random isolated PostgreSQL databases. They never load the original repository environment or make a real inventory/model request. The T07 handover records passing checks, service cleanup and remaining qualification separately. No fixture pass proves a real provider sandbox or native account support.
