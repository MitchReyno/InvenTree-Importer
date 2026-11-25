-- Typed stage outputs for `bench-intake-input/7`. Earlier inputs, rows and outbox items are unchanged.

-- The component that hands a photo view's image to the provider records its release; a `/7`
-- citation of the view is admitted only once it has one.
ALTER TABLE agent_session_outbox
  DROP CONSTRAINT agent_session_outbox_kind_check,
  ADD CONSTRAINT agent_session_outbox_kind_check CHECK (kind IN ('status','observation','lot','regroup','proposal','question','reply','photo_view','photo_release'));
CREATE UNIQUE INDEX agent_session_outbox_photo_release_view ON agent_session_outbox(session_id,(payload->>'view_seq'))
  WHERE kind='photo_release';

-- What a `/7` question rests on beyond its sealed spec: the evidence it names as new and the
-- conflict it settles. A later ask about the same subject and fields is stored only when it names
-- evidence or a conflict none of these did.
CREATE TABLE processing_question_basis (
  question_id uuid PRIMARY KEY REFERENCES processing_question(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  evidence_version_ids uuid[] NOT NULL CHECK (cardinality(evidence_version_ids) <= 8),
  conflict text CHECK (conflict IS NULL OR char_length(conflict) BETWEEN 1 AND 512),
  FOREIGN KEY (batch_id,question_id) REFERENCES processing_question(batch_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER processing_question_basis_immutable BEFORE UPDATE OR DELETE ON processing_question_basis
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- The lots a `/7` Examine identity rested on when published, its own and each whose observation
-- set it cites: by lot, each member Capture showed, with its revision and same-item mark. A
-- successor's claim and the Processing read compare them, with the identity's cited observations
-- and observation sets, against Capture now.
CREATE TABLE processing_identity_basis (
  proposal_id uuid PRIMARY KEY REFERENCES processing_proposal(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  members jsonb NOT NULL CHECK (jsonb_typeof(members)='object')
);
CREATE INDEX processing_identity_basis_batch ON processing_identity_basis(batch_id);
CREATE TRIGGER processing_identity_basis_immutable BEFORE UPDATE OR DELETE ON processing_identity_basis
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
