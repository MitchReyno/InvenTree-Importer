# Change proposal

## Problem and intended outcome

Bench Intake's processing agents don't have stage-specific jobs, don't receive what earlier stages found, and produce outputs that mostly go nowhere. This is documented in detail in [Agent sessions: inputs, outputs and flow](../../../docs/agent-sessions.md), Part 1. Mitch saw the effect on 2026-11-23: an Images session researched the part and published a catalogue proposal instead of producing images. He asked for the inputs and outputs of every agent session type to be redesigned, refactoring where needed, and for the repository's skills to be ported into the app's sessions.

The outcome sought:

- **Each stage has its own contract:** a sealed input brief, a tool set, an instruction pack and a typed output, with boundaries the server enforces. The agent stages are Examine, Research and Images.
- **Hand-offs carry content.** A lot session starts from a brief of everything already known: Examine's identity and observations, the operator's corrections, answers and notes (weighed first), the questions already asked, and the item's evidence. Updates arrive as precise changes. `ask` returns an existing question instead of asking twice.
- **The Inventory agent is replaced by an app-side Match step.**
  - The app searches InvenTree deterministically after Examine, again after Research identifies an item, and once more before approval.
  - Examine and Research add judgement as match notes.
  - Before any research or photo work, the operator decides: add stock, fill what's missing, new Part, or already imported. Research and Images then run in the mode that decision calls for.
- **Items without a useful identifier are identified first.** Research runs in an identify mode before anything is matched. Its identity amendment updates the lot's key details: the MPN, manufacturer and aliases.
- **Research and Images sessions serve several lots.** A session takes a group of lots of the same stage and mode, up to a configurable cap per stage, while each lot keeps its own job, decision and status.
- **Images produces images.** It proposes crop recipes for the Part image, stock images and extras. The app renders them from the originals, and the operator confirms them.
- **The skills are ported.** The deterministic scripts (grid overlay, crop and montage, logo matcher) become intake MCP tools. The skills' rules become per-stage instruction packs, with long reference text behind a `read_guide` tool.
- **Outputs reach records.**
  - Confirmed values fill agent-made Parts.
  - A Match decision sets each lot's target.
  - Confirmed recipes become the Part image and stock attachments.
  - The Match check before approval blocks on new conflicts.

Mitch's decisions, 2026-11-23:

- typed proposals per stage;
- agent values are proposed until confirmed;
- the chip logo set may be bundled;
- new work targets only the new VM profile and the synthetic fixture;
- Match replaces the Inventory agent;
- a lot waiting on its match question doesn't start Research or Images;
- "add stock" takes a stock photo, and a Part photo only when the Part has none;
- Research's identify round updates the lot's key details;
- Research and Images sessions each serve several lots, with separate caps: "Lots per Research session" and "Lots per Images session", 1–20, defaulting to 5 and 8.

The visible parts are on the canvas page "Agent stages" (v81; design log D44–D46). The brief on the session page is D43, carried over from the abandoned `lot-session-handoff` (#244).

## Change identity and linked items

- Change: `agent-stage-inputs-outputs`. Branches are `feat/agent-stage-inputs-outputs-<suffix>`, and subjects are `type(agent-stage-inputs-outputs): …`.
- **BI-022** (new): Agent stage inputs and outputs. It replaces the abandoned BI-020 plan `lot-session-handoff`. BI-020 and BI-021 now belong to `polish-ui-styling-and-loading` and its follow-up.
- Related:
  - BI-019 (`improve-agent-interaction`, #243) provides the stepped `ask`, the session history, the `photo_view` record, agent-reported web sources and the session page. Its session rows and drawer assume one subject per session; this change's PRs adapt them for multi-lot sessions, and #243 isn't changed.
  - BI-017 also edits the session instructions.
  - BI-015 keeps the existing-record comparison fields; Match takes over its Inventory questions.

## Current behavior and evidence

[docs/agent-sessions.md](../../../docs/agent-sessions.md) Part 1 is the evidence, with file references at `9db1921e`. In summary:

- **One prompt for every stage.** Research, Images and Inventory get identical instructions, and nothing restricts what a stage may propose.
- **Sealed context never shown.** The opening leaves out the pinned identity, observation readings and the catalogue vocabulary, so successors redo Examine's work and can't reference existing records.
- **No useful output from Images or Inventory.** Images has no image output; its proposal mostly satisfies Inventory's gate. Inventory is never auto-queued and reads no other stage's output.
- **Nothing reaches InvenTree.** Proposals annotate and project records, but no proposal value is applied to a Part spec or an approval effect.
- **Weak re-steering.** Revisions are one-line summaries, corrections don't reach Examine, and nothing prevents repeated questions.

## Scope and non-goals

In scope:

- **Inputs:** a shared brief and per-stage briefs, sealed in `bench-intake-input/7`, with `read_lot` and full readings in `read_batch`.
- **Outputs:** typed per-stage proposals (`examine-identity/1`, `research-identity/1`, `research/1`, `images/1`), with stage and mode boundaries enforced.
- **Match:** search keys, InvenTree and cross-batch search, verdicts, the sufficiency check, app-owned match questions, stage modes, late matches and validation before approval.
- **Identify mode and identity amendments.**
- **Hand-off rules:** precedence of human facts, the duplicate-question check, revisions that carry the change, durable delivery.
- **MCP tools:** `inspect_region`, `preview_images`, `propose_images`, `match_logo`, `read_guide`, `read_lot`, `read_vocabulary`.
- **Images:** crop recipes with straightening and bounded light adjustments, rendered by the media decoder.
- **Profile:** a new profile `shared-vm-agent/4` with per-stage instruction packs, admission, and a live requalification on Claude and Codex.
- **Multi-lot sessions:** lot groups claimed up to each stage's sealed cap, per-lot brief sections and `read_lot` scope, per-lot waits, release and requeue on an identity change, per-lot retry after a failure, one slot per session, and the two settings.
- **Records:** confirmed values into Parts and lots, Match decisions into targets, recipes into Part and stock images, and gaps mode into update effects for existing Parts.
- **UI:**
  - the Processing › Match step, replacing Inventory;
  - the Images step's proposed crops;
  - the match question;
  - Review confirmation;
  - the brief on the session page;
  - the lots a session serves on session rows and pages, and the two caps in Settings › Agents › Sessions.
- **Legacy:** Inventory stage removal for new work, and the default profile changing to the synthetic session fixture.

Non-goals:

- company logos;
- saved web snapshots (needs an app-side fetch with receipts);
- free-form chat between agents;
- removing the legacy handlers (`remove-unused-legacy-code`);
- an agent inventory search tool;
- auto-deciding exact matches without asking (a possible later setting).

Compatibility:

- Retained attempts, proposals and Inventory jobs of earlier profiles stay readable.
- New data formats are forward-only, with the same rollback rule BI-019 adopted.

Authority:

- InvenTree is read only through the app's read token.
- Every write still goes through review and approval.
- Agent outputs are proposals.

## Reuse and dependency assessment

| Option | Fit | Limits and cost | Evidence (2026-11-23) | Unknowns |
| --- | --- | --- | --- | --- |
| Real Claude or Codex skills in the VM | The skills already exist | Admission forbids skills and slash commands on both providers, and Codex has no Claude-style skills | `intake-server/src/agents/session/session-admission.ts`, `agents/codex.ts` | — |
| Scripts staged in the VM runner image | Python and Pillow are already in the image | No provenance for outputs, guest uploads would be needed, transfers spend the image budget, and the image must be rebuilt per change | `tooling/deployment/guest/Dockerfile` | — |
| Port the scripts as intake MCP tools run by the media decoder (recommended) | Both providers, every profile; full-resolution originals; reproducible, recorded results; the decoder already owns orientation, crops and renditions | The scripts (Python, Pillow and numpy) are reimplemented in TypeScript on the decoder's `sharp` 0.35.5 (crop, rotate, affine straightening, linear colour, sharpen, composite) and `@napi-rs/canvas` 1.1.0 (grid labels, montage text); the logo matcher's thresholding and correlation run on raw pixel buffers | `media-decoder/package.json`, `media-decoder/src/decode.ts`, `intake-server/src/media/region-crops.ts`, the skills' scripts | Matcher parity with `match.py` on the logo set; size of the bundled logo set, 6.9 MB |
| An Inventory agent with a search tool | Keeps a per-lot judgement pass | A session per lot; search inside an agent is unrecorded and unrepeatable; it duplicates Research's context | Part 1 of the doc | — |
| An app Match step, with judgement from Examine and Research (recommended) | Deterministic and repeatable; saves research on known Parts | New app module and questions owned by the app | The InvenTree read credential and reads in `intake-server/src/inventory/` and `records/` | The search strategy (open question) |

No new third-party runtime dependency is needed: the decoder already ships `sharp` and `@napi-rs/canvas`. The ports are custom TypeScript, kept small and tested for parity against the scripts' outputs on fixtures. The logo set is bundled, with Mitch's approval for private use.

## Capabilities

### New capabilities

- `processing-match`: searching InvenTree and unapproved lots for each lot, verdicts, the sufficiency check, the match question, stage modes, late matches and validation before approval.

### Modified capabilities

- `processing-stage-pipeline`: the stage order without the Inventory agent, successors started by Match, identify mode, identity amendments, and revisions that carry the change.
- `processing-agent-sessions`: the tool boundary per stage, stage briefs, typed outputs and boundaries, precedence, no repeated questions, re-reading the brief, image and logo tools, and stage guides.
- `processing-workspace`: the Match step replaces the Inventory step and drawer; the Images step shows proposed crops; the brief on the session page.
- `capture-media`: derived crops gain straightening and bounded light adjustments.
- `review-records`: agent values are proposed until confirmed.
- `approval-preparation`: Match validation blocks approval; confirmed images and gaps fills become effects.

## Impact and dependencies

- **Contracts:** the input `/7` with its lot group, the two agent settings, briefs, the typed proposals, `revision/2`, `match` inbox items, match records and questions, the new tool argument and result schemas, and the recipe `/2`.
- **Intake server:**
  - `processing/` (a Match module, stage queueing, the stable identity's merge);
  - `agents/tools/` (new tools, stage checks);
  - `agents/session/` (opening, profile);
  - `capture/` (lot key-detail updates);
  - `records/` and `review/` (proposed values, effects);
  - migrations (the profile, stage instructions, match tables, the match question store, outbox and inbox kinds);
  - `agents/shared-vm/` and the session worker (pairing, guest and tool-worker checks for the new profile).
- **Media decoder:** TypeScript ports on `sharp` and `@napi-rs/canvas`: recipe rendering with straightening and light adjustments, the grid overlay, the montage, and the logo matcher with its data.
- **Frontend:**
  - Processing › Match;
  - Processing › Images review;
  - match questions in Needs you;
  - Review confirmation of proposed values and targets;
  - the brief entry on the session page.
- **Prerequisites:**
  - BI-019 PR-B (stepped questions, needed by the match question), PR-D (history read, `photo_view`, web sources) and PR-E (session page);
  - coordinate instruction edits with BI-017;
  - BI-019 PR-F's activity popover, whose fourth stage row task 3 adapts to Match if PR-F has merged first;
  - Mitch's go-ahead for the live requalification.

## Open decisions and assumptions

Open, recorded in the doc's open questions (2.10):

- the light-adjustment bounds;
- vocabulary paging versus search;
- the InvenTree search strategy and normalisation;
- how long search results are cached and how long a decision stays valid;
- an auto-accept setting for exact matches.

Assumed:

- **Strong keys:** an MPN or type with a manufacturer, an NSN, a label IPN or SKU, or the import reference or barcode with the batch.
- **The brief budget** is 48 KiB.
- **Per-stage instruction text:** decided in the design: base text in the profile row and per-stage packs in an immutable `processing_stage_instructions` table, digest-sealed in the input.
