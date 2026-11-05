# Intake server code guidelines

Follow the [shared guidelines](../CODE_GUIDELINES.md), [implemented architecture](ARCHITECTURE.md) and [testing tiers](TESTING.md). These rules cover server TypeScript/tests; they grant no inventory authority or new capability.

## Make decisions and effects visible

Keep validation, domain decisions, persistence and transport in their owning modules. Transactions should show ordered steps with named results, including authorization, locks, committed intent, send and checkpoint. Do not hide this order in compressed callbacks or generic retry helpers.

Write one statement/declaration per line and use branch braces. Name compound certainty/ownership checks; avoid nested ternaries and boolean chains whose refusal conditions cannot be explained locally. Named predicates retain explicit inputs.

Extract meaningful operations such as authority reads, prior-attempt validation or snapshot building. Keep cohesive invariants together; no size quotas or framework replacement for explicit sequencing.

The shared [patterns to avoid](../CODE_GUIDELINES.md#patterns-to-avoid) are explicit server review checks. In particular, use named request/domain types, distinguish integrity checks from runtime shape validation, keep authorization/storage/HTTP responsibilities separate, and classify unexpected infrastructure failures honestly.

Leave blank lines between functions and methods. Split mixed responsibilities at named domain boundaries while preserving transaction, lock, intent/send/checkpoint and publication order.

## Read queries and formatted code

Separate awaited query results from selection/projection when combining them obscures behavior. Use descriptive row/operation names across substantial scopes.

Format SQL templates with visible clauses and parameter arrays easy to compare with placeholders. Preserve immutable migration bytes.

Run `pnpm lint:readability` for the shared runtime TypeScript check, then `pnpm format` and inspect the result. The readability autofix splits variable declarations and adds branch braces; Prettier expands blocks/types/arguments. Authors still explain predicates, separate responsibilities and lay out SQL strings. Tests should distinguish setup, action and independently expected effects.

## Verify changes

Behavior changes require the applicable typecheck, fast/contract and PG/process tiers in [TESTING.md](TESTING.md). Formatting-only edits need stability, generated-byte checks, types and affected tests; selected hosted CI remains merge evidence. CI skips the PG/process tiers, so run them locally and record the results in the handover (see [TESTING.md](TESTING.md)).

Preserve protected-target guards, retained identities/bytes and no-retry behavior during conflict resolution. Apply shared Markdown readability rules to server documentation, keeping observed evidence distinct from proposed capability.
