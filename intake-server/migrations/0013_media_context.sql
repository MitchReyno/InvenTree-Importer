CREATE TABLE media_group_history (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  group_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 256),
  retired boolean NOT NULL,
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,group_id,revision),
  FOREIGN KEY(batch_id,group_id) REFERENCES media_group(batch_id,id)
);
CREATE TABLE media_evidence_note (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  text text NOT NULL CHECK(length(text)<=8192),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,evidence_id,revision),
  FOREIGN KEY(batch_id,evidence_id) REFERENCES media_evidence(batch_id,id)
);
CREATE TRIGGER media_group_history_immutable BEFORE UPDATE OR DELETE ON media_group_history
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER media_evidence_note_immutable BEFORE UPDATE OR DELETE ON media_evidence_note
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
