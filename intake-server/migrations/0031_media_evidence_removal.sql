-- The operator removes an evidence item from the batch, or restores it. Its latest row by revision
-- is its state, and no row means present. Bytes and history stay; only this append-only record changes.
CREATE TABLE media_evidence_removal (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  removed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,evidence_id,revision),
  FOREIGN KEY(batch_id,evidence_id) REFERENCES media_evidence(batch_id,id)
);
CREATE INDEX media_evidence_removal_batch ON media_evidence_removal(batch_id,evidence_id,revision DESC);
CREATE TRIGGER media_evidence_removal_immutable BEFORE UPDATE OR DELETE ON media_evidence_removal
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
