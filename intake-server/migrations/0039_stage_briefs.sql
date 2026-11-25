-- Stage briefs for `bench-intake-input/7`. Earlier profiles, inputs and rows are unchanged.

-- Each profile's per-stage instruction pack, which follows the profile's instructions in the
-- system prompt. A `/7` input seals its stage's digest and the claim checks it. Earlier profiles
-- have none; `synthetic-session/1` has minimal fixture packs.
CREATE TABLE processing_stage_instructions (
  profile_id text NOT NULL REFERENCES processing_profile(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('examine','research','images')),
  instruction_bytes bytea NOT NULL CHECK (octet_length(instruction_bytes) BETWEEN 1 AND 65536),
  instruction_digest bytea NOT NULL CHECK (instruction_digest = sha256(instruction_bytes)),
  PRIMARY KEY (profile_id, stage)
);
CREATE TRIGGER processing_stage_instructions_immutable BEFORE UPDATE OR DELETE ON processing_stage_instructions
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
INSERT INTO processing_stage_instructions(profile_id,stage,instruction_bytes,instruction_digest)
SELECT 'synthetic-session/1', stage, convert_to(text,'UTF8'), sha256(convert_to(text,'UTF8'))
FROM (VALUES
  ('examine','Synthetic fixture Examine pack. Read the batch with read_batch, record what each photo shows, form lots and publish each lot''s identity.'),
  ('research','Synthetic fixture Research pack. Read the lot with read_lot and publish what the brief supports.'),
  ('images','Synthetic fixture Images pack. Read the lot with read_lot and publish what the brief supports.')
) AS pack(stage,text);

-- The pages of a sealed brief that don't fit in its input's manifest. The manifest seals each
-- page's index and digest, so the sealed view never reads mutable capture data.
CREATE TABLE processing_input_page (
  input_id uuid NOT NULL REFERENCES processing_input(id) ON DELETE RESTRICT,
  page_index integer NOT NULL CHECK (page_index BETWEEN 1 AND 64),
  page_bytes bytea NOT NULL CHECK (octet_length(page_bytes) BETWEEN 1 AND 262144),
  page_digest bytea NOT NULL CHECK (page_digest = sha256(page_bytes)),
  PRIMARY KEY (input_id, page_index)
);
CREATE TRIGGER processing_input_page_immutable BEFORE UPDATE OR DELETE ON processing_input_page
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- Current views a session has read, kept so later pages come from the same brief after an
-- edit. Bounded per attempt: the most recently read views are kept, the rest dropped.
CREATE TABLE processing_brief_view (
  attempt_id uuid NOT NULL REFERENCES processing_attempt(id) ON DELETE RESTRICT,
  brief_digest bytea NOT NULL CHECK (brief_digest = sha256(brief_bytes)),
  brief_bytes bytea NOT NULL CHECK (octet_length(brief_bytes) BETWEEN 1 AND 2097152),
  -- When the session last read it; the bound keeps the most recent.
  read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (attempt_id, brief_digest)
);

-- The reading an operator correction replaced, so a brief can show it before and after. The
-- author and time are the capture revision's.
CREATE TABLE capture_evidence_observation_correction (
  batch_id uuid NOT NULL,
  observation_id uuid NOT NULL REFERENCES capture_evidence_observation(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  before_readings jsonb NOT NULL,
  after_readings jsonb NOT NULL,
  PRIMARY KEY (observation_id, revision),
  FOREIGN KEY (batch_id, revision) REFERENCES capture_revision(batch_id, revision)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX capture_evidence_observation_correction_batch
  ON capture_evidence_observation_correction(batch_id);
CREATE TRIGGER capture_evidence_observation_correction_immutable
  BEFORE UPDATE OR DELETE ON capture_evidence_observation_correction
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- Why a lot is flagged to look at again: each operator edit that sets the flag, and each time
-- the lead looks again (which clears it). A brief lists the reasons since the last look.
CREATE TABLE capture_lot_reexamine (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  lot_id uuid NOT NULL REFERENCES capture_lot(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  event text NOT NULL CHECK (event IN ('observation_edited','same_item_changed','looked_again')),
  observation_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((event = 'looked_again') = (observation_id IS NULL))
);
CREATE INDEX capture_lot_reexamine_batch ON capture_lot_reexamine(batch_id, lot_id, recorded_at);
CREATE TRIGGER capture_lot_reexamine_immutable BEFORE UPDATE OR DELETE ON capture_lot_reexamine
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- Agent observations the operator had edited before corrections kept the earlier reading. Only
-- these show a current reading whose earlier one is not known; later edits keep theirs.
CREATE TABLE capture_evidence_observation_unkept_correction (
  observation_id uuid PRIMARY KEY REFERENCES capture_evidence_observation(id) ON DELETE RESTRICT
);
INSERT INTO capture_evidence_observation_unkept_correction(observation_id)
SELECT id FROM capture_evidence_observation
WHERE origin = 'agent' AND operator_edited AND status = 'active';
CREATE TRIGGER capture_evidence_observation_unkept_correction_immutable
  BEFORE UPDATE OR DELETE ON capture_evidence_observation_unkept_correction
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- Instruction items a `/7` session will not be given: a group's instruction still pending when the
-- operator ungroups it. The item stays (the inbox is append-only); delivery skips it.
CREATE TABLE agent_session_inbox_withdrawal (
  item_id uuid PRIMARY KEY REFERENCES agent_session_inbox(id) ON DELETE RESTRICT,
  withdrawn_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER agent_session_inbox_withdrawal_immutable BEFORE UPDATE OR DELETE ON agent_session_inbox_withdrawal
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
