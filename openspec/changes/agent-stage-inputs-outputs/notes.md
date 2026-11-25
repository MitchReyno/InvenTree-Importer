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

"Read" means given, not acknowledged: a `read_inbox` call acknowledges what the previous call returned, and a provider turn acknowledges what it accepted (`onDelivered`) only when the turn settles successfully, so between those an item returned by `read_inbox` or handed to the provider is recorded in `agent_session_inbox_release` under the batch's share lock, and an ungroup never withdraws a given item. Every `/7` attempt queued on a lineage withdraws what is still unacknowledged for groups already retired, given to an earlier attempt or not, since the new conversation inherits the lineage's inbox; the history keeps a withdrawn item that some attempt was given. Earlier inputs keep today's relay, which gives every group's latest instruction. A deployment without Processing (media only) has no sessions, so its ungroup withdraws nothing.

A sealed brief isn't resealed when a group is retired after it: sealed inputs stay immutable (the design's constraint), and the session sees the change through its current view, as it does any other edit after sealing.

The trade-off: an instruction that still applies after ungrouping must be given again, on the new group or as a lot or batch note. The requirement is the delta's "Stage sessions get only live groups' instructions".

### Evidence removed after sealing

A sealed brief keeps its bytes, but nothing of evidence removed since reaches the session (`processing/brief-removal.ts`): the opening a first turn is given, sealed pages and kept current views are served without the removed item's evidence, observations and their corrections, evidence notes and keep-out regions, without a pinned identity that cites or relies on any of them (withheld whole; the removal also marks it stale), with its observations left out of lot entries and other observations' links to them (`same_item_as`, `supersedes_observation_id`) dropped, and any other entry still naming it left out, as a native prompt staged from an earlier input leaves them out. A page's `sha256` still names the view it belongs to.

### Contract validators compile on first use

`@invimport/contracts` compiled every schema when it was imported. The brief's schemas added about 1.2 s to that, which made the API's first start miss the 5 s health deadline in `tests/pg/media-startup-authority.test.ts`. Validators now compile on first use and are kept; importing the contracts takes about 0.2 s instead of about 2.8 s. A contracts test compiles every schema, so a schema the strict compiler refuses still fails a test.

### Open items

- **Notes appear twice in a `/7` input.** A `/7` manifest keeps the `/6` `notes` list, because note citations are verified against the note text the manifest seals (`processing/provenance.ts`), and the brief's human section holds the same notes again. Only the brief's copy can move to the page store, so a lot whose notes alone come near the 240 KiB cap is refused as `processing_input_capacity` although its brief pages would fit. Moving note citations onto the brief belongs with the typed outputs and their citations (task 2); until then the limit is the one `/6` has.

### Contracts

- `ProcessingInputV7` lives in `contracts/src/stage-input.ts`, so the brief can carry a `SessionProposal` without a module cycle between `processing.ts` and `brief.ts`. `SessionInput` (the `/6` or `/7` union) is a type only. Registering it as a schema would put both versions in the generated OpenAPI document again; `decodeSessionInput` validates against the version the bytes name.
- `answeredValues` now takes the question's view (`questionView`), so the brief can read answers to questions it decodes from their stored bytes. A `/1` answer's prompt is the view's title, which for a `/1` question is its prompt, as before.

## Task 8 (PR-H): the brief on the session page

- **Where the brief travels.** The history read says where each `/7` attempt's brief sits, as `briefs` beside the page's entries: the attempt id, its queue time, and the brief's stage and section counts as sealed, from the manifest the page already decodes. The entries are a read of their own (`GET …/processing/:jobId/attempts/:attemptId/brief`). Not a history entry: a brief is the attempt's input, not an inbox or outbox row, and an entry would have reached every reader of history entries (the drawer, the batch activity read) and the page's 200-row count. Not the entries inline either, as first built: review found that a page could carry any number of briefs (attempts with no rows of their own), each up to 64 stored pages, read again on every poll, the drawer's included, and that one unreadable stored page would fail the whole history. A brief sorts before every row at its attempt's queue time, and its place comes on the page whose span holds that time. Earlier inputs had no brief, so their responses keep their shape: no `briefs` key, and the brief read is not found.
- **Read when opened (Mitch's decision, 2026-11-26).** Reading every brief as its card mounted still fanned out: live updates invalidate everything under the server scope, so each hint re-read every mounted brief. The collapsed line is now built from the sealed counts the page carries, and the entries are read only when the operator opens the card, and again each time they do, under a query key outside the scope's prefix (still keyed by scope, and cleared with the cache when the scope changes), so live updates neither cancel nor re-read them. The trade-off: the collapsed line is the brief as sealed ("Brief at start · …"), so its counts include entries whose evidence was removed since and count the human section as sealed, not today's corrections; it doesn't present them as current totals. The opened brief still leaves removed evidence out.
- **What the brief read carries.** Every page of the sealed brief, from the manifest and `processing_input_page`, without what concerns evidence removed since (`withoutRemovedMedia`), as a session's read tools serve it, with its sealed sections. Each opening of the card reads under a key of its own and shows only that read, so evidence removed while it was closed never shows from an earlier read, even one still in flight, and a failed read shows as failed, not as the earlier copy. Since live updates don't re-read it (the decision above), evidence removed while a card is open shows gone when it is next opened.
- **Corrections and readings.** Each correction an observation had is listed under it, and a reading shows its markings and then, labelled "read as", its transcribed text, so moving words between them reads as a change; one with neither reads "no markings or text". A lot edit shows the quantity the operator left, and an item to keep out of frame its photo, page and region. The list of questions is headed "Already asked": not asking them twice is task 2's to enforce.
- **The drawer leaves it out.** The spec names the session page; the drawer keeps its history as before.
- **Collapsed every time.** The canvas board (D43, "Lot session hand-off") notes the brief opening on the first visit and collapsing after it; the spec's scenario has the operator expanding it to see the correction. The page always shows it collapsed: remembering visits would be new per-viewer state that neither the spec nor the tasks ask for. Open item below.
- **Examine's brief.** The canvas draws Research's brief. An Examine lead's brief reads "Brief at start · the batch", with its lots and Parts; an Images brief adds the items to keep out of frame. The empty Match and vocabulary sections show nothing until their data arrives.

### Open items

- The canvas's "collapsed after the first visit" (open on the first) isn't built; it needs a decision on remembering visits per viewer.

## Task 7 (PR-G1): the stage profile, packs and guides

### Mitch's decisions on the wording (2026-11-26)

Mitch reviewed the draft base instructions, stage packs and guide sections and approved them, with these choices:

1. **The opening under `/4`.** The packs carry the lead's instructions, the ask guidance and the catalogue guidance, so a `shared-vm-agent/4` opening leaves those three out and keeps the brief, status-line, inbox, description-style and web lines. `synthetic-session/1`'s opening is unchanged.
2. **Web search for Examine.** Allowed only to read an unfamiliar logo or marking, never to work out what the part is. Images researches nothing.
3. **Ask guidance** is sealed in the base. The `ask` tool's description keeps its unsealed copy, which isn't version-bound: only the base's copy changes with a new profile.
4. **Tags aren't Examine's.** Examine reports NOS signals, the seal and a visible NSN, never tags; tags are derived by rule in Records.
5. **Quantity.** Examine never claims a count. "Counted from the photo" is the estimate's basis, not an exact quantity.
6. **The vocabulary is the batch's.** It is the batch's retained catalogue observations (at most 100 read observations), not the whole InvenTree catalogue. Full-catalogue reads are an open item below.
7. **The Research guide has nine sections**, each under about 1.8 KB: modes, nsn-and-data-books, datasheets, identity-and-specifications, naming-and-notes, vocabulary-and-gaps, logos, logo-look-alikes and same-part.
8. **The brief's vocabulary section** is filled in this PR, from the same lookup `read_vocabulary` uses.

### Wording after review

- The Examine pack said to pass `base_revision` "on every write", but only `record_observation`, `propose_lot` and `regroup` take it (the strict `propose`, `ask` and `reply` contracts refuse it). The pack now names those three. This is a correction to the approved text, not a change of what it asks for.
- The base keeps the `/3` web lines for every stage, as approved; the Examine and Images packs limit their stages' web use. Until the web gates admit `/4` (PR-G2), its inputs seal web research off and its opening carries no web line.

### Guides are sealed as a whole

The guide table's rows can't be changed or deleted, but a row could still be added for a profile. So `processing/stage-policy.ts` records each stage guide's digest (`stageGuides`): the SHA-256 of the canonical ordered list of its sections' names, titles and text digests. `read_guide` serves a guide only while its stored sections give that digest; otherwise the call fails (`tool_failed`) rather than serve a section the profile wasn't sealed with.

### `read_vocabulary`'s lookup interface

- **Both a filter and paging.** `read_vocabulary({ kind?, search?, page_token? })`. `kind` is category, parameter_template, category_parameter or company; `search` (1–100 characters) keeps entries whose label contains it, regardless of case. Results come 50 to a page (`VOCABULARY_PAGE_SIZE`), ordered by kind, label and observation, with the total and a `next_page_token` while more remain.
- **Tokens** are the cursor as canonical JSON in base64url: a digest of the kind and search, a digest of the matching list (its observations in order) and the offset. Digests keep a token within the 512-character token bound whatever the search. A token continues only the kind and search it came with; any other call with it is a correctable `validation_failed`. When the matching records change between pages, the token is refused as `stale` and the session reads again from the first page, so no entry is repeated or skipped. Tokens aren't bound to the attempt: the read is of the session's own batch and writes nothing.
- **Current, not sealed.** The brief's vocabulary section is the list as sealed; `read_vocabulary` reads it again from the batch now, through the capture snapshot, with the same projection (`processing/vocabulary.ts`). Observations from an earlier target context are left out, since a proposal can't cite them.

### How `/4` is reached before activation

- `configuredInputVersion` seals `/7` for `shared-vm-agent/4` when `ProcessingConfig.stageInputs` is `local`, as for `synthetic-session/1`. Configuration can't select `/4` (`INTAKE_PROCESSING_PROFILE` refuses it, with or without the switch), so only tests reach it.
- `/4` is stage-only: sealing a `/6` input for it is refused as `unsupported_processing_profile`, and its `/6` fields are checked only as part of the `/7` input.
- `webAccess()` stays `/3`-only until PR-G2 changes the web-policy gates together, so `/4` inputs seal web research off. The packs and base keep the web lines; they apply once activation turns the gates on.
- Tests run `/4` sessions with the synthetic driver (`formedBatch` takes the profile). Admission, pairing and the VM path stay PR-G2's.

### Open items

- **Full-catalogue vocabulary.** The vocabulary is the batch's observed catalogue records (at most 100 read observations), not InvenTree's whole catalogue. Reading the full catalogue needs an InvenTree reader in the API process, since the session worker has none; until then Research mostly proposes new categories and reports gaps.
- **The session page doesn't list vocabulary entries.** The brief on the session page (PR-H) shows the entries it knows; a Research brief's vocabulary entries are left out of the opened card, and its collapsed line doesn't count them.

## Task 5 (PR-E1) status

Merged in #274. Task 5 (PR-E1) adds recipe `/2` and the decoder operations behind `inspect_region`, `preview_images` and `match_logo`; nothing outside tests calls them yet. Task 1 (PR-A) is recorded above.

## Changes to the plan

### Task 5 (PR-E1)

- **2026-11-25T11:05+11:00, task 5 (PR-E1):** the design said the montage is a `sharp` composite and the 6.9 MB logo set is bundled. The montage takes `sharp` thumbnails onto a canvas, since its labels are drawn with canvas text in the decoder's bundled font (LiberationSans from `pdfjs-dist`), and the bundle is the set's index and logos (222,134 bytes of files); its grid pages are for reading by eye and stay with the skill. The design is updated to match.

- **2026-11-25T09:39+11:00, task 5 (PR-E1):** the contract schemas for recipe `/2` and the new decoder headers were written with their contract tests rather than before them; the decoder's parity tests were written first and failed first.

## Unexpected challenges

### Task 5 (PR-E1)

- **2026-11-25T09:39+11:00, task 5:** straightened crops can't match crop.py pixel for pixel. Pillow's rotation uses a cubic with a = −1 and libvips, which renders every view, Catmull-Rom (a = −0.5); resampling the script's geometry with a = −1 leaves no value more than four levels off, and with a = −0.5 it reproduces the decoder's residual. Matching exactly would need a second resampler, which the task's single geometry path rules out. Crops, quarter turns and white balance with intact gains match exactly. Superseded for straightening by the ground-truth entry below.
- **2026-11-25T09:39+11:00, task 5:** crop.py's own white balance turns saturated parts on the bench fixture (a gold band, a green part) by 7–9.5°, so on those crops the guard holds the gains back and parity can't apply. The parity fixtures use crops whose gains the guard leaves intact, and a third crop checks the guard on the script's gains.

## Decisions made during implementation

### Task 5 (PR-E1)

- **2026-11-25T09:39+11:00, task 5:** the light bounds. White balance: grey-world gains bounded to ±15% (crop.py allows 0.8–1.25), held back in eighths towards 1 until no saturated pixel turns more than 5°, and refused when even an eighth would. "Saturated" is HSV saturation of at least ½ with channels at least 48 levels apart: near-neutral pixels are what white balance should turn, and below that spread one level of rounding moves hue by several degrees. Contrast is a luminance autocontrast clipping 0–5% at each end (`contrast_clip_permille` 0–50), gamma 0.5–2.0 (`gamma_thousandths` 500–2000), and sharpening crop.py's unsharp mask (radius 2, 80%, threshold 3) on luminance; each scales a pixel's three channels together, held back where one would clip, so only rounding turns a hue; outside the saturated pixels the guard protects, rounding can turn or erase the hue of a dim pixel. Rejected: per-channel versions as in crop.py, which shift hue.
- **2026-11-25T09:39+11:00, task 5:** a recipe `/2` derivation (`media-decode/1` with the recipe) that doesn't fit its page, or whose white balance the guard refuses, returns `malformed` rather than a new decode state, which would change the retained media states. `preview_images` reports that refusal per crop, so a refused recipe needn't reach a proposal; a page or geometry mismatch fails the whole preview as `malformed`.
- **2026-11-25T11:05+11:00, task 5:** after review, the light step as a whole turns no pixel that was saturated before it more than 5° from its source. Independent rounding could turn a dark saturated pixel such as RGB 48, 5, 0 to another hue or to grey, so luminance adjustments keep a protected pixel's output spread at 12 levels or more and rebuild its middle channel from the rounded ends, which bounds their hue error at 2.5°; when they follow white balance, its guard gets the remaining 2.5°. `render_view` takes a recipe `/2` without marks, lit at full resolution and then sized, as the task's outcome says. Each `preview_images` page names the evidence version, digest and page it came from; a recipe naming another, two slots giving one version different originals, or two slots claiming one evidence page with different pixels, is `malformed`. `match_logo` shrinks a query to 1024 px on its long edge before thresholding, so an elongated crop can't square up beyond the decoder's memory.
- **2026-11-25T09:39+11:00, task 5:** `match_logo` straightens with the shared view geometry (quarter turns and at most 15°), not straighten.py's arbitrary rotation or four-corner flattening, which would be a second geometry path. A blank region returns no candidates, where match.py fails.
- **2026-11-25T15:10+11:00, task 5:** straightened crops are judged against ground truth, with Mitch's agreement. `generate.py` draws the bench scene again with exact geometry at 8× supersampling, blurs it 0.8 px in floating point (an integer blur darkens flat colours by about 2 levels at that sigma), prints the photo's own seed-22 σ 4 noise on the subject as one-pixel cells, and averages it down: once upright as a source, and once turned directly onto each straightened crop's output grid (−7° and −86.5°). A crop of that source must come within a mean of 1 level and 6% of values more than 4 levels off, and at least as close as crop.py's crop of the same source; against crop.py itself it only has to stay within a mean of 3 levels and 20%, a check for gross geometry errors that a more accurate method can't fail. The truth has a bias: grain printed as one-pixel cells favours area-averaging resamplers, and no rotation can reproduce real sensor noise, which isn't attached to the subject.
- **2026-11-25T15:10+11:00, task 5:** straightening resamples with bicubic everywhere, Mitch's choice: the view geometry, recipe `/2` derivations and retained `documentary-rotated-region/1` derivations, so retained derivations derive as before. Against the truth, means at 7° and −3.5° were: bicubic 0.64 and 0.74, `lbb` 0.58 and 0.67, `nohalo` 0.53 and 0.64, crop.py 1.12 and 1.44. A 51 MP straightened, lit derivation in the decoder container took 8.4 s with bicubic, 18.8 s with `nohalo` and 17.1–18.6 s with `lbb`. The gain of about 0.1 level from `nohalo` or `lbb` doesn't justify more than twice the time against the decoder's 25 s in-container kill (`timeout --signal=KILL 25s`, inside the runner's 30 s wall clock). An ordinary crop's rotation samples at about 1:1 (shrinking to a view is a separate filtered resize), so no reduction case is handled; a crop only a pixel or so across on one axis can be enlarged on that axis when the corner guard's window rounds up to whole output pixels. An earlier figure of 9.3 s for `lbb` was measured with bilinear: sharp has no `interpolators.lbb` key (it is `interpolators.locallyBoundedBicubic`), and an undefined interpolator falls back to libvips' bilinear.
- **2026-11-25T15:10+11:00, task 5:** with Mitch's agreement, the white-balance hue guard keeps its 16-level floor, and the capture-media delta now states the exception: a colour whose brightest channel or channel spread is below 16 levels has no hue protected. Extending the guard to near-black pixels such as RGB 10, 4, 0 would hold white balance back on almost every photo with dark shadow noise.
- **2026-11-25T13:45+11:00, task 5:** the white-balance guard watches saturated pixels down to the same 8-bit floor (HSV saturation ≥ ½, brightest channel and spread both ≥ 16), since the earlier 48-level cutoff let a fully saturated dark band such as RGB 47, 20, 0 turn 6°. When luminance adjustments follow white balance, the final pixels are checked against the source and white balance is held back a further eighth until no saturated pixel turns more than 5°, or refused. This supersedes the 48-level cutoff in the light-bounds entry.
- **2026-11-25T13:10+11:00, task 5:** luminance adjustments have their own protection floor, separate from the white-balance guard's 48-level cutoff (since lowered to the same floor): a pixel is protected when its brightest channel and channel spread are both at least 16 levels, where its hue is meaningful in 8 bits. Below the floor one level of rounding already moves hue by 4° or more, so the pixel isn't protected and darkening may turn or erase its hue; forcing a spread there would brighten near-greys. Rejected: reusing the guard's cutoff, which left RGB 47, 5, 0 unprotected.
- **2026-11-25T13:10+11:00, task 5:** `inspect_region` places each box name at the first of its box's inner corners, or just outside its top or bottom, where all its ink fits the preview and covers no earlier name, then falls back to the box's number (also used for a name that draws no ink, such as spaces), and reports the `drawn_label` each box got. Chips are sized from the glyphs' measured ink bounds, as grid.py's text box is, so stacked accents can't be clipped. Label spacing is measured on the labels an interval would draw, not on the region's undrawn end.
- **2026-11-25T11:40+11:00, task 5:** `inspect_region` departs from grid.py where its labels would be unreadable. A label that would run off the right or bottom edge goes on its line's other side, and lines and labels share one preview pixel kept inside the preview (grid.py can round the last line off the canvas). Labels thin out to every 2nd, 5th, 10th … line until they fit apart, and the x label row moves up in a preview only just taller than it. Axis labels and box names are laid out together, drawn over the lines and outlines; an axis label that won't fit or whose chip would intersect another is left out and not reported. The labelled values are grid.py's, but the port can thin labels where grid.py's chips still fit, since it measures the decoder's font and keeps a wider gap between labels. Gamma 1000, the identity curve, counts as no luminance adjustment, so it leaves white balance its full hue budget.
- **2026-11-25T09:39+11:00, task 5:** the logo set bundled with the decoder is the skill's `index.json` and 483 logo GIFs (222,134 bytes of files), copied into `media-decoder/src/chip-logos/` so the image build's existing `media-decoder/src` copy carries it; the grid pages (4,865,808 bytes) stay with the skill. A test checks the copy against the skill byte for byte. Reference shapes are computed on each request rather than shipped precomputed, so the set can't drift from its shapes; a match took under 3 s in the decoder container, within its time limit.

## Open items

### Task 5 (PR-E1)

- Recipe `/2` is in the decoder's input header only. The retained `MediaRecipe` DTO, its OpenAPI schema and the intake server's parsing of the new output headers (`media/decoder-output.ts`) come with their first consumer in task 10 (PR-E2) or task 6 (PR-F).
