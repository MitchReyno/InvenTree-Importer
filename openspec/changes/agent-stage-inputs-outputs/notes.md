# Implementation notes

Departures from the plan, surprises and decisions the design left open, recorded as the work happens. Routine verification and review outcomes are in each PR's description.

## Task 1 (PR-A): briefs, input `/7`, read tools and the stage packs scaffold

### The test-only switch

- The switch is `INTAKE_TEST_STAGE_INPUTS=local`, read into `ProcessingConfig.stageInputs`. It is accepted only with `INTAKE_PROCESSING_PROFILE=synthetic-session/1`; any other value or profile refuses to start (`unsupported_processing_profile`).
- No configuration sets it. The development launcher's environment allowlist (`tooling/dev/environment.cjs`) doesn't carry it, so neither `pnpm dev` nor an environment file can turn it on; only tests that start their own processes pass it.
- A session worker paired to the VM bridge refuses to start with the switch on, so the bridge route keeps sealing `/6`. A worker refusing a retained `/7` input on the bridge route is task 11's, with the route setting that replaces the switch.

### Brief revision and views

- A brief's `revision` is the capture revision it was read at. A question asked or answered without a capture edit leaves the number unchanged but changes the brief, so `newer` compares the brief's digest, not the number, and reports the current capture revision.
- Pages are at most 32 KiB of entries (`BRIEF_PAGE_MAX_BYTES`), and a brief has at most 64 pages (`BRIEF_MAX_PAGES`). An entry too large for a page, or a brief past 64 pages, is refused as `processing_input_capacity`.
- A sealed input keeps as many leading pages in its manifest as fit the 240 KiB retained-input cap; the rest are in `processing_input_page`, each sealed by index and digest in the manifest.
- Current views are kept whole in `processing_brief_view`, by digest, up to 2 MiB each. An attempt keeps the four it read most recently (`BRIEF_VIEWS_PER_ATTEMPT`) and drops the rest; a token for a dropped view, or a view past 2 MiB, is refused as `brief_revision_unavailable`.
- Page tokens are the cursor (attempt, view, digest, page) as canonical JSON in base64url. They are not secret: a read checks that the token names the caller's own attempt and a view it still has, so a forged token can only reach that session's own briefs.

- A read tool assembles a current view in one repeatable-read transaction, so a view never mixes two capture revisions. It takes no row locks there (a repeatable-read transaction can fail on a lock of a row changed since its snapshot); it checks that the capability names a running session whose attempt is running and current, and writes only the attempt's kept views. No test interleaves an edit inside one read: the interleaving needs a seam inside the read that the code doesn't have.
- `read_batch` for a `/7` lead returns the revision of the brief it read as `revision`, the lead's `base_revision`, so a write based on an older page is checked against that page's revision. A `/6` lead's `read_batch` keeps its schema (no arguments) and description.

### Brief content the design left open

- **Asked-list fields.** Examine works on markings, identity and quantity; Research on markings, identity and research; Images on identity and images. A question is in a brief when its subject is in scope and it names one of the stage's fields. An earlier runner question names no fields and is always listed.
- **Pinned identities.** A Research brief's identity entry carries the pinned proposal as published (summary, catalogue, sources and reliance), not only its id, so its values reach Research before typed outputs exist.
- **Lot edits** are the lots the operator created or edited, as they stand now, each with `edit_id` `lot:<lot>@<revision>`. No proposal source kind cites an edit yet; citations belong to the typed outputs (task 2).
- **Corrections from before this change.** An agent observation the operator edited with no kept reading shows its current reading with `earlier_known: false`. The row doesn't say what the edit was, so an observation only moved or marked as the same item by the operator reads this way too.
- **Images orientation.** Observations record a region and page but no orientation, so the Images brief carries regions only. Items to keep out of frame are other lots' active observations on the same page of the same version.
- **Notes.** A brief's notes are the batch's, the lot's and its Part's capture notes, the lot's context, and the group and evidence notes of the session's media scope. A current view reads the media notes again; if the scope can't be read (its media isn't ready or is over the input limits), it keeps the sealed ones.

### Pipeline version

- Every queueing entry point (Start, stable-identity successors, replacement and the Start-fresh check) seals the lead's version, read from the lead job's current input, or the configuration's when the batch has no lead. A new lead seals the configuration's version.
- Under `/7`, Start offers Research and Images only: an Inventory stage in the request is left out, and a request for Inventory alone is refused as `unsupported_processing_stage`. Waiting for a `/7` lead is PR-G2's; Match for operator-entered lots is PR-C's.
- A batch with a `/7` lead under a configured profile that can't run it (no stage packs, or no sessions at all) is refused at Start, replacement and the Start-fresh check as `unsupported_processing_profile` (422), an existing Start-fresh refusal, rather than sealing a `/6` attempt or a legacy stage for it.

### Open items

- **Notes appear twice in a `/7` input.** A `/7` manifest keeps the `/6` `notes` list, because note citations are verified against the note text the manifest seals (`processing/provenance.ts`), and the brief's human section holds the same notes again. Only the brief's copy can move to the page store, so a lot whose notes alone come near the 240 KiB cap is refused as `processing_input_capacity` although its brief pages would fit. Moving note citations onto the brief belongs with the typed outputs and their citations (task 2); until then the limit is the one `/6` has.

### Contracts

- `ProcessingInputV7` lives in `contracts/src/stage-input.ts`, so the brief can carry a `SessionProposal` without a module cycle between `processing.ts` and `brief.ts`. `SessionInput` (the `/6` or `/7` union) is a type only. Registering it as a schema would put both versions in the generated OpenAPI document again; `decodeSessionInput` validates against the version the bytes name.
- `answeredValues` now takes the question's view (`questionView`), so the brief can read answers to questions it decodes from their stored bytes. A `/1` answer's prompt is the view's title, which for a `/1` question is its prompt, as before.
