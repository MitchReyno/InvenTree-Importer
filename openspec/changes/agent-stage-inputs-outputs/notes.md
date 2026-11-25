# Implementation notes

Departures from the plan, surprises and decisions the design left open, recorded as the work happens. Routine verification and review outcomes are in each PR's description.

## Task 1 (PR-A): briefs, input `/7`, read tools and the stage packs scaffold

### The test-only switch

- The switch is `INTAKE_TEST_STAGE_INPUTS=local`, read into `ProcessingConfig.stageInputs`. It is accepted only with `INTAKE_PROCESSING_PROFILE=synthetic-session/1`; any other value or profile refuses to start (`unsupported_processing_profile`).
- No configuration sets it. The development launcher's environment allowlist (`tooling/dev/environment.cjs`) doesn't carry it, so neither `pnpm dev` nor an environment file can turn it on; only tests that start their own processes pass it.
- A session worker paired to the VM bridge refuses to start with the switch on, so the bridge route keeps sealing `/6`. A worker refusing a retained `/7` input on the bridge route is task 11's, with the route setting that replaces the switch.

### Brief revision and views

- A brief's `revision` is the capture revision it was read at. A question asked or answered without a capture edit leaves the number unchanged but changes the brief, so `newer` compares the brief's digest, not the number, and reports the current capture revision.
- Entries are packed into pages of about 32 KiB (`BRIEF_PAGE_MAX_BYTES`); an entry larger than that, such as a note of 8,192 four-byte characters, has a page of its own. One entry may be at most 192 KiB (`BRIEF_ENTRY_MAX_BYTES`), a stored page 256 KiB, and a brief at most 64 pages (`BRIEF_MAX_PAGES`); beyond those the brief is refused as `processing_input_capacity`.
- A sealed input keeps as many leading pages in its manifest as fit the 240 KiB retained-input cap; the rest are in `processing_input_page`, each sealed by index and digest in the manifest.
- Current views are kept whole in `processing_brief_view`, by digest, up to 2 MiB each. An attempt keeps the four it read most recently (`BRIEF_VIEWS_PER_ATTEMPT`), where continuing a view with its token counts as reading it (the view is kept again even if a read at once had dropped it), and drops the rest; a token for a dropped view, or a view past 2 MiB, is refused as `brief_revision_unavailable`.
- Page tokens are the cursor (attempt, view, digest, page) as canonical JSON in base64url. They are not secret: a read checks that the token names the caller's own attempt and a view it still has, so a forged token can only reach that session's own briefs.

- A read tool assembles a current view in one repeatable-read transaction, so a view never mixes two capture revisions. It takes no row locks and writes nothing there (a repeatable-read transaction can fail on a row changed since its snapshot); it checks that the capability names a running session whose attempt is running and current. A read that starts a current view keeps it afterwards in its own transaction, under a per-attempt advisory lock, so reads at once neither fail on each other's insert nor keep more than the bound. No test interleaves an edit inside one read: the interleaving needs a seam inside the read that the code doesn't have.
- `read_batch` for a `/7` lead returns the revision of the brief it read as `revision`, the lead's `base_revision`, so a write based on an older page is checked against that page's revision. A `/6` lead's `read_batch` keeps its schema (no arguments) and description.

- A read with a token never pages the current brief; only a read that starts a current view does, and a current brief past the page bounds or the 2 MiB view bound is refused there as `brief_revision_unavailable`, while the sealed brief and views already kept still page. A batch can reach that: a hundred group instructions of 8,192 four-byte characters are a hundred pages. Each saved instruction is its own entry, so no single entry grows with the number of groups, and a retired group's instruction is left out, so ungrouping brings such a brief back within bounds.

### Brief content the design left open

- **Asked-list fields.** Examine works on markings, identity and quantity; Research on markings, identity and research; Images on identity and images. A question is in a brief when its subject is in scope and it names one of the stage's fields. An earlier runner question names no fields and is always listed.
- **Parts.** The Examine brief has a `parts` section (each Part subject's id, label and revision), as `read_batch` listed Parts for earlier leads.
- **Pinned identities.** A Research brief's identity entry carries the pinned proposal as published (summary, catalogue, sources and reliance), not only its id, so its values reach Research before typed outputs exist.
- **Lot edits** are the lots the operator created, edited or left out of the batch, as they stand now. Each state's `edit_id` (`lot:<lot>:<digest>`) is derived from what the entry says, because an exclusion advances no lot revision: the same id always means the same facts. Including a lot again returns an untouched agent lot to its agent state, so it leaves no lot edit. No proposal source kind cites an edit yet; citations belong to the typed outputs (task 2).
- **Corrections from before this change.** Migration `0039` lists the agent observations the operator had edited by then (`capture_evidence_observation_unkept_correction`). Those with no kept reading since show their current reading with `earlier_known: false`; the row didn't say whether an edit changed the reading, so one that only moved an observation or marked it the same item reads this way too. Edits after the migration are never guessed at: only a kept reading is a correction.
- **Why a lot is flagged.** Each operator edit that flags a lot to look at again (an observation edited, or a same-item mark set or cleared) is kept in `capture_lot_reexamine`, with the lead looking again, which clears the flag. The Examine brief's lot entry lists the reasons since the last look, the most recent 100 with a count of the rest; a flag set before reasons were kept has none listed.
- **Images orientation.** Observations record a region and page but no orientation, so the Images brief carries regions only. Items to keep out of frame are other lots' active observations on the same page of the same version.
- **Batch and order notes** from the batch settings are human facts too (`setting_note` entries, the latest saved text of each; a removed note is left out).
- **Question state.** An asked question's state is the one the Processing read shows: an open question whose job's input is no longer current, or whose asking attempt was replaced, reads as superseded (`staleOpenQuestion`, shared by both).
- **Notes.** Each note says what it is about: a subject, an evidence item (`evidence_id`) or an evidence group (`group_id`), or none of them for the whole batch. A brief's notes are the batch's, the lot's and its Part's capture notes, the lot's context, and the group and evidence notes of the session's media scope. A current view reads the media notes again; if the scope can't be read (its media isn't ready or is over the input limits), it keeps the sealed ones that still apply: those of evidence with a version not removed and of groups not retired.

### Pipeline version

- Every queueing entry point (Start, stable-identity successors, replacement and the Start-fresh check) seals the lead's version, read from the lead job's current input, or the configuration's when the batch has no lead. A new lead seals the configuration's version.
- Under `/7`, Start pins the lot's stable identity (the lead's latest identity proposal relying on the lot's current observation set that isn't stale), as stable-identity queueing does; an operator-entered lot has none. Earlier versions keep Start's empty pins.
- Under `/7`, Start offers Research and Images only: an Inventory stage in the request is left out, and a request for Inventory alone is refused as `unsupported_processing_stage`. Waiting for a `/7` lead is PR-G2's; Match for operator-entered lots is PR-C's.
- Only a configuration that seals `/7` writes one, checked before any provider setting is read (at Start, replacement, the Start-fresh check and stable-identity queueing), since no setting can make another configuration seal it. Under any other configuration a batch with a `/7` lead gets no new `/7` input: its lead's stable identity stands and queues nothing (as with no provider on), and Start, replacement and the Start-fresh check refuse as `unsupported_processing_profile`.
- A batch with a `/7` lead under a configured profile that can't run it (no stage packs, or no sessions at all) is refused at Start, replacement and the Start-fresh check as `unsupported_processing_profile` (422), an existing Start-fresh refusal, rather than sealing a `/6` attempt or a legacy stage for it.

### Retired groups' instructions (Mitch's decision, 2026-11-25)

Mitch decided that `/7` sessions don't get a retired (ungrouped) evidence group's instructions. The brief leaves them out, and the instruction relay (`instructNewSession`, `deliverInstructions`, `deliverMissingInstructions`) skips them for `/7` lineages. Ungrouping a group withdraws its instruction items that a `/7` session hasn't read yet: they stay in the append-only inbox, recorded in `agent_session_inbox_withdrawal`, and every reader of pending items skips them, so they are never delivered and wake nothing. Items already read stay in the history; withdrawn ones were never given to the session, so the history leaves them out. A wake and a turn's settlement take the batch's share lock before requeueing a session, so an ungroup (which holds the batch) orders against them and its withdrawal is seen. A resume whose only pending items were withdrawn between queueing and claim goes back, without a turn, to the state the wake moved it from (kept in `agent_session_resume`), so an interrupted session stays interrupted.

"Read" means given, not acknowledged: the synthetic driver and the provider acknowledge an item only on their next read, so an item returned by `read_inbox` or handed to the provider is recorded in `agent_session_inbox_release` under the batch's share lock, and an ungroup never withdraws a given item. Every `/7` attempt queued on a lineage withdraws what is still unacknowledged for groups already retired, given to an earlier attempt or not, since the new conversation inherits the lineage's inbox; the history keeps a withdrawn item that some attempt was given. Earlier inputs keep today's relay, which gives every group's latest instruction. A deployment without Processing (media only) has no sessions, so its ungroup withdraws nothing.

A sealed brief isn't resealed when a group is retired after it: sealed inputs stay immutable (the design's constraint), and the session sees the change through its current view, as it does any other edit after sealing.

The trade-off: an instruction that still applies after ungrouping must be given again, on the new group or as a lot or batch note. The requirement is the delta's "Stage sessions get only live groups' instructions".

### Contract validators compile on first use

`@invimport/contracts` compiled every schema when it was imported. The brief's schemas added about 1.2 s to that, which made the API's first start miss the 5 s health deadline in `tests/pg/media-startup-authority.test.ts`. Validators now compile on first use and are kept; importing the contracts takes about 0.2 s instead of about 2.8 s. A contracts test compiles every schema, so a schema the strict compiler refuses still fails a test.

### Open items

- **Notes appear twice in a `/7` input.** A `/7` manifest keeps the `/6` `notes` list, because note citations are verified against the note text the manifest seals (`processing/provenance.ts`), and the brief's human section holds the same notes again. Only the brief's copy can move to the page store, so a lot whose notes alone come near the 240 KiB cap is refused as `processing_input_capacity` although its brief pages would fit. Moving note citations onto the brief belongs with the typed outputs and their citations (task 2); until then the limit is the one `/6` has.

### Contracts

- `ProcessingInputV7` lives in `contracts/src/stage-input.ts`, so the brief can carry a `SessionProposal` without a module cycle between `processing.ts` and `brief.ts`. `SessionInput` (the `/6` or `/7` union) is a type only. Registering it as a schema would put both versions in the generated OpenAPI document again; `decodeSessionInput` validates against the version the bytes name.
- `answeredValues` now takes the question's view (`questionView`), so the brief can read answers to questions it decodes from their stored bytes. A `/1` answer's prompt is the view's title, which for a `/1` question is its prompt, as before.
