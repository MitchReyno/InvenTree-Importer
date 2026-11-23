## MODIFIED Requirements

### Requirement: Session tool boundary

A `native-agent/2` session SHALL reach the application only through an app-owned tool server scoped to that session. The tool server SHALL offer exactly these tools:

- status
- read_batch, record_observation, propose_lot and regroup (the Examine lead session only)
- propose
- ask
- reply
- fetch_evidence
- read_inbox

The session SHALL have no shell, filesystem, web, arbitrary code execution, collaboration, image generation, arbitrary MCP, inventory-write or approval tools. Codex MAY expose only the previously accepted inert exceptions list_mcp_resources, list_mcp_resource_templates, read_mcp_resource and request_user_input: the intake server SHALL expose no resources and server-initiated requests SHALL be refused. User skill catalogues and deferred callable tools outside this boundary MUST NOT be available.

A session whose input is `bench-intake-input/7` (`shared-vm-agent/4` or `synthetic-session/1`) SHALL be offered, on its intake tool server, the tools listed above, with the Examine lead keeping read_batch, record_observation, propose_lot and regroup, plus its stage's tools from "Stage tool sets", and no other intake tools. The prohibition above governs `native-agent/2`; a `/7` session's built-in and web tools are those of its profile, as "Stage tool sets" states.

#### Scenario: Session starts with only app tools

- **GIVEN** a queued `native-agent/2` attempt for Claude or Codex
- **WHEN** the adapter starts the provider session
- **THEN** the adapter admits only a provider version covered by offline full-surface qualification, verifies the required effective configuration and scoped MCP tools before each fresh or resumed turn, and refuses unknown versions or configuration drift. Runtime checks reject forbidden tool events. Offline qualification does not attest the exact tool list of each subscription request.

#### Scenario: Wrapped or deferred tools

- **GIVEN** a provider exposes exec-wrapped intake tools or a deferred advisor tool
- **WHEN** a fresh or resumed turn is admitted
- **THEN** that configuration fails offline qualification or is refused by admission/runtime checks; a runtime refusal does not undo an already executed action. An incomplete init list alone is not qualification evidence.

### Requirement: Resume idle sessions for pending input

When a waiting, paused or finished session has a pending inbox item, the system SHALL schedule a resume of that session's provider conversation with the queued items, within the concurrency limit.

For `/7` work, an item for a lot that Match holds SHALL NOT wake the session; it stays pending until that lot's wait ends. A `match` item that ends a held lot's wait SHALL wake it.

While an actor's cutover drain fence is set, and after it has switched to `/4`, no `/3` resume SHALL be scheduled; the item stays pending for the upgrade action.

#### Scenario: Chat with a finished session

- **GIVEN** a finished session that can run on the actor's current profile, with no drain fence or Match hold applying to it
- **WHEN** the operator sends a chat message
- **THEN** the message is queued, the session's provider conversation is resumed with it, and the agent's reply appears in that session's chat.

#### Scenario: Resume fails

- **GIVEN** a queued inbox item for a finished session whose provider conversation cannot be resumed (for example, a missing transcript or a sign-in failure)
- **WHEN** the resume is attempted
- **THEN** the item stays pending, the session shows a typed waiting-for-login or resume-unavailable state, and the operator can start a fresh session that receives the pending items.

#### Scenario: Chat during the cutover drain

- **GIVEN** a finished `shared-vm-agent/3` lead on an actor whose drain fence is set
- **WHEN** the operator sends it a chat message, or new evidence arrives
- **THEN** no `/3` turn is queued, the item stays pending, and the upgrade action later carries it into the `/7` attempt.

#### Scenario: Chat after the switch to `/4`

- **GIVEN** a retained `shared-vm-agent/3` lead on an actor that now serves `/4`
- **WHEN** a chat message or new evidence arrives for it
- **THEN** no `/3` turn is queued and the item stays pending until the upgrade action carries it into a `/7` attempt.

#### Scenario: Chat for a held lot

- **GIVEN** a parked `/7` Research session whose only lot waits on its match question
- **WHEN** the operator sends it a chat message, and later answers the match question
- **THEN** the chat alone doesn't resume the session, and the decision's `match` item resumes it with the chat delivered first.

### Requirement: Authoritative citations for fetched evidence

A successful fetch_evidence delivery SHALL include the complete source reference accepted by proposal validation, including exact evidence/version identity and authoritative SHA-256. Preview and crop bytes MUST NOT be mistaken for the cited original version's digest. Merely receiving a notice or knowing a digest SHALL NOT establish delivery authority.

For `/7` sessions, delivery authority SHALL be a release recorded for the view on the current attempt. A recorded release SHALL survive a worker restart for that attempt; a view without one SHALL be fetched again.

#### Scenario: New evidence during a session

- **GIVEN** a same-batch evidence notice delivered after the initial manifest
- **WHEN** the session successfully fetches that version and cites the returned source reference
- **THEN** source validation accepts the delivered reference subject to existing currentness checks.

#### Scenario: Failed or unauthorized fetch

- **GIVEN** a wrong-batch version, failed byte delivery or exhausted budget
- **WHEN** fetch_evidence is attempted
- **THEN** no delivery authority is granted and a subsequent citation is refused; after worker restart evidence must be fetched again under the existing delivery rules.

#### Scenario: Released view after a restart

- **GIVEN** a `/7` session whose fetch of a photo has a recorded release, and another fetch whose release was never recorded
- **WHEN** the worker restarts and the same attempt continues and cites both
- **THEN** the released view's citation is accepted, and the other is refused until the photo is fetched again.

### Requirement: Web tools run under a new VM profile version

VM tool sessions with the web tool surface SHALL run under `shared-vm-agent/3`, or under `shared-vm-agent/4` for `/7` work, each a profile with its own fixed instructions, instruction digest and tool profile version, added without changing an earlier profile or any earlier migration. A worker serving `shared-vm-agent/3` SHALL settle any `shared-vm-agent/2` attempt it finds, queued or requeued by a resume, as failed with `agent_profile_retired`, keeping its history, and SHALL NOT run it under either surface.

#### Scenario: Attempt queued before the upgrade

- **GIVEN** a `shared-vm-agent/2` attempt queued before the upgrade and never started
- **WHEN** the worker now serving `shared-vm-agent/3` claims work
- **THEN** that attempt fails with `agent_profile_retired` and a summary saying to run the step again, and no provider process starts

#### Scenario: Message to a finished session from before the upgrade

- **GIVEN** a finished `shared-vm-agent/2` session with its transcript and proposals
- **WHEN** the operator sends it a message after the upgrade
- **THEN** the requeued attempt fails with `agent_profile_retired` instead of waiting, the session's history and proposals stay, and the message stays pending for a new attempt

#### Scenario: Retained instructions stay valid

- **GIVEN** retained `shared-vm-agent/2` attempts and their sealed instruction digests
- **WHEN** the new profile is added
- **THEN** the `shared-vm-agent/2` profile row and its digest are unchanged, so those attempts still decode and display

#### Scenario: Web access under the stage profile

- **GIVEN** a new `/7` Research session on `shared-vm-agent/4` with public web pages allowed
- **WHEN** it runs
- **THEN** it has the web tool surface under `/4`, and retained `shared-vm-agent/3` attempts ran under `/3` only until the cutover's drain; after it they stay readable, and the upgrade action carries waiting or parked ones into `/7`.

### Requirement: Cancellation and recovery

Cancelling a session SHALL abort its active turn and reap its process group before the session releases its slot. An unconfirmed reap SHALL keep the slot occupied and visible. After a worker restart, the system SHALL NOT silently continue a turn that was in flight. Such a session SHALL become interrupted, keep its outbox and pending inbox, and resume only through an explicit operator action, a new pending inbox item, or, for `/7` work, a committed Match continuation.

#### Scenario: Worker restarts mid-turn

- **GIVEN** a running session with no committed Match continuation when the worker stops abruptly
- **WHEN** the worker starts again
- **THEN** the session is shown as interrupted, its delivered status lines and proposals remain, and no provider call is started until a resume is requested or triggered by the inbox.

#### Scenario: Crash after a decision is acknowledged

- **GIVEN** a `/7` session that acknowledged a lot's `match` item through `read_inbox`, committing its mode and continuation
- **WHEN** the worker crashes before the turn settles, or after it settles and before the continuation dispatches
- **THEN** the supervisor first requires any occupied slot's reap to be confirmed, as today; once it is, the session resumes from the committed continuation under the new mode without another message, and while it isn't, the continuation waits with the slot shown occupied.

## ADDED Requirements

### Requirement: Stage tool sets

For sessions whose input is `/7`, the intake tool server SHALL add these tools to the common set, which is the list in "Session tool boundary":

- Examine: read_batch with full readings, inspect_region, match_logo and read_guide.
- Research: read_lot, read_vocabulary, match_logo and read_guide.
- Images: read_lot, inspect_region, preview_images, propose_images and read_guide.

This requirement does not change the guest built-in and web tools a shared VM profile adds outside the intake tool server.

#### Scenario: Images has no vocabulary

- **GIVEN** an Images session of `shared-vm-agent/4`
- **WHEN** admission compares its intake tool list
- **THEN** the list holds the common tools plus read_lot, read_guide, inspect_region, preview_images and propose_images, and nothing else.

### Requirement: Sessions start from a sealed brief

A session whose input is `/7` SHALL start from a brief sealed into its input: the batch and its instructions, the human-provided facts marked as human, the questions already asked about its subject, the evidence it may fetch with the regions earlier stages used, the lot's match state, and its stage's additions (see the stage contract in the design). The opening SHALL render it within its budget and say when `read_lot` or `read_batch` holds the rest.

#### Scenario: Research starts with Examine's findings

- **GIVEN** Examine identified a lot from a photo region read as "16.000 ECS 2338" and slip line 4
- **WHEN** the lot's Research session starts
- **THEN** its opening holds the identity with its id, both observations with their readings and regions, the operator's facts, the asked questions and the evidence list.

#### Scenario: Brief edited between pages

- **GIVEN** a session that read page one of its lot's current view at revision 5
- **WHEN** the operator edits the lot, and the session asks for page two with the returned token
- **THEN** page two comes from revision 5 and says that a newer revision exists.

### Requirement: Research and Images sessions serve lot groups

For `/7` work, a Research or Images session SHALL serve a lot group: 1 to N lot jobs of its stage, all in the same mode at claim, in one batch, taken at claim, oldest first, from queued lots that Match allows and that are neither superseded nor stale. N SHALL be the attempt's sealed cap for its stage. A lot that becomes ready after the claim SHALL go to a new session. Each lot SHALL keep its own job, and the session SHALL hold one concurrency slot.

#### Scenario: Three lots in one session

- **GIVEN** a Research cap of 5 and three lots decided as new Parts while a fourth waits on its match question
- **WHEN** a Research session is claimed
- **THEN** it serves the three decided lots, and the fourth joins a later session once decided.

### Requirement: Lots per session settings

Settings › Agents › Sessions SHALL hold "Lots per Research session" and "Lots per Images session", each an integer from 1 to 20, defaulting to 5 and 8, sealed into each new `/7` Research and Images attempt. A cap of 1 SHALL give one-lot sessions.

#### Scenario: Cap changed mid-batch

- **GIVEN** a running Images session sealed with a cap of 8
- **WHEN** the operator sets the cap to 2
- **THEN** the running session keeps its lots, and the next Images session takes at most 2.

### Requirement: Per-lot handling inside a group

Each lot section of the brief SHALL hold the lot's identity, observations, human facts, asked questions, evidence and match state and mode. `read_lot` SHALL return only lots in the group. A lot waiting on Match SHALL not stop the session's other lots.

#### Scenario: One lot pauses in identify mode

- **GIVEN** a Research session identifying two lots
- **WHEN** one lot's amendment opens a match question
- **THEN** the session keeps working on the other lot, and resumes the first when its mode arrives.

#### Scenario: Late candidate for one lot

- **GIVEN** a running Images session serving lots A and B
- **WHEN** a match note from lot A's Research adds an alias, and the new search finds a candidate without changing A's identity revision
- **THEN** only lot A's membership is held: the session stops work on A at the end of its turn, publishes B's proposal while the question is open, and resumes A when its mode arrives.

### Requirement: Lots leave a group individually

A lot whose identity is changed after the claim by anyone but the group's own session SHALL be released and requeued, with the session told. A failed session's incomplete lots SHALL be requeued one by one, and Start fresh on a lot SHALL move it to a new session.

#### Scenario: Amendment releases one Images lot

- **GIVEN** a running Images session serving lots A and B
- **WHEN** lot A's Research session amends A's identity and the new search finds a candidate
- **THEN** A is released from the Images group with the session told, B keeps running, and A joins a later Images group once Match allows it.

#### Scenario: Session fails

- **GIVEN** an Images session that finished one of its three lots
- **WHEN** it fails
- **THEN** the two unfinished lots are requeued individually, and the finished lot keeps its proposal.

### Requirement: Skipped lots leave their group

When a decision skips a stage for a lot held in that stage's group, such as already imported for a held Images lot, its membership SHALL end as finished. Its peers SHALL continue, and the session SHALL settle when no active member remains.

#### Scenario: Held Images lot decided as already imported

- **GIVEN** an Images session whose lot A is held on a late candidate while lot B runs
- **WHEN** lot A is decided as already imported
- **THEN** A's membership ends as finished and B continues; had A been the last active member, the session would settle.

### Requirement: Typed stage outputs

For `/7` sessions, each agent stage SHALL publish only its own output kind: `examine-identity/1` for Examine, `research-identity/1` and `research/1` (each with match notes) for Research, and `images/1` for Images. Research MAY publish `research-identity/1` in identify mode and in any later mode. Earlier profiles keep publishing their existing proposal versions. The server SHALL refuse a proposal of another kind, or carrying fields the stage or its mode may not propose.

#### Scenario: Images can't research

- **GIVEN** an Images session
- **WHEN** it proposes a category or description
- **THEN** the proposal is refused with a correctable validation result naming the disallowed fields.

### Requirement: Proposals name their lot

For `/7` work, an Examine proposal SHALL name any live lot of its batch, and a Research or Images proposal SHALL name an active member of its session's group, and the server SHALL refuse one naming another lot.

#### Scenario: A lot outside the group

- **GIVEN** a Research session serving lots A and B, and Examine leading the same batch
- **WHEN** Research proposes for lot C and Examine proposes for lot C
- **THEN** Research's proposal is refused naming the lot, and Examine's is accepted.

### Requirement: Human facts take precedence

`/7` stage packs SHALL weigh human-provided facts above the evidence as the agent reads it, that evidence above earlier stages' readings, and those above web sources. When evidence contradicts a human fact, the session SHALL ask once, citing the conflict, and SHALL NOT replace the human value.

#### Scenario: Doubting a correction

- **GIVEN** an operator-corrected reading that a datasheet appears to contradict
- **WHEN** Research proposes
- **THEN** it uses the operator's value or asks one question naming the reading, the datasheet and the conflict.

### Requirement: Questions are not asked twice

In a session whose input is `bench-intake-input/7`, `ask` SHALL return the existing question, storing nothing, when an open or answered question already covers the same subject and overlapping fields, unless the new question names evidence or a conflict the earlier one did not.

#### Scenario: Examine already asked

- **GIVEN** an answered question on the lot about identity and quantity, and a `/7` Research session
- **WHEN** Research asks about the same fields with no new evidence or conflict
- **THEN** ask returns the answered question and its answer, and nothing new appears in Needs you.

### Requirement: Image and logo tools run in the app

`inspect_region`, `preview_images` and `match_logo` SHALL run in the media decoder on the retained original the session may fetch, and return their images and results to the agent within the frame and image limits. `preview_images` SHALL render a recipe exactly as approval would derive it. `propose_images` SHALL publish only recipes whose source versions are in scope for the lot it names.

#### Scenario: Preview then propose

- **GIVEN** an Images session with a photo of a single diode
- **WHEN** it previews a recipe with a quarter turn and a 3.5° straightening and then proposes it
- **THEN** the recipe render behind the preview and the later derived crop are the same pixels before montage labels, downscaling or encoding, the montage depicts that render, and the proposal names the source version and recipe.

### Requirement: Stage guides on demand

`read_guide` SHALL return named sections of the stage's guide, sealed with the profile, ported from the repository's skills (cropping rules, logo look-alikes, research sources and traps, transcription rules).

#### Scenario: Look-alike logos

- **GIVEN** an Examine session unsure between two similar maker's marks
- **WHEN** it calls read_guide for the logo look-alikes section
- **THEN** it receives that section's text, the same for every session of the profile.
