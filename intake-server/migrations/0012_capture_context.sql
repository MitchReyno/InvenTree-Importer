CREATE TABLE capture_context (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  subject_id uuid,
  version bigint NOT NULL CHECK(version>0),
  value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(batch_id,subject_id,version),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_lot(batch_id,id)
);
CREATE INDEX capture_context_latest ON capture_context(batch_id,subject_id,version DESC);
CREATE TRIGGER capture_context_immutable BEFORE UPDATE OR DELETE ON capture_context
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
