-- T08 operator review: lot lineage/retirement, warning dispositions and human instructions.
-- Additive and append-only. Existing capture/review rows and sealed bytes are unchanged.
ALTER TABLE capture_lot ADD UNIQUE(batch_id,id);

CREATE TABLE capture_lot_lineage (
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  predecessor_lot_id uuid NOT NULL,
  successor_lot_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('split','merge')),
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(predecessor_lot_id,successor_lot_id),
  CHECK(predecessor_lot_id<>successor_lot_id),
  FOREIGN KEY(batch_id,predecessor_lot_id) REFERENCES capture_lot(batch_id,id),
  FOREIGN KEY(batch_id,successor_lot_id) REFERENCES capture_lot(batch_id,id)
);
CREATE INDEX capture_lot_lineage_successor ON capture_lot_lineage(batch_id,successor_lot_id);

-- A retired lot keeps identity and history; it leaves the active capture list.
CREATE TABLE capture_lot_retirement (
  batch_id uuid NOT NULL,
  lot_id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(batch_id,lot_id) REFERENCES capture_lot(batch_id,id)
);

-- A dismissal is current only while its subject's fact digest still matches.
CREATE TABLE capture_issue_disposition (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  code text NOT NULL CHECK(code ~ '^[a-z_]{1,64}$'),
  dependency_digest bytea NOT NULL CHECK(octet_length(dependency_digest)=32),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1024),
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_subject(batch_id,id)
);
CREATE INDEX capture_issue_disposition_subject
  ON capture_issue_disposition(batch_id,subject_id,code,created_at DESC,id);

-- Versioned human instructions for the batch (null group) or one evidence group.
CREATE TABLE capture_instruction (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  group_id uuid,
  version bigint NOT NULL CHECK(version>0),
  text text NOT NULL CHECK(length(text)<=8192),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(batch_id,group_id,version),
  FOREIGN KEY(batch_id,group_id) REFERENCES media_group(batch_id,id)
);

CREATE TRIGGER capture_lot_lineage_immutable BEFORE UPDATE OR DELETE ON capture_lot_lineage
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_lot_retirement_immutable BEFORE UPDATE OR DELETE ON capture_lot_retirement
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_issue_disposition_immutable BEFORE UPDATE OR DELETE ON capture_issue_disposition
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_instruction_immutable BEFORE UPDATE OR DELETE ON capture_instruction
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
