-- Evidence-group location assignments: append-only human intent for lots linked to the group's
-- evidence. Shared-Part assignments reuse capture_selection(field='location') on the Part subject.
CREATE TABLE capture_group_location (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  group_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version>0),
  value jsonb NOT NULL CHECK(jsonb_typeof(value)='object' AND value->>'mode' IN ('unset','clear','set')),
  observation_id uuid,
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,group_id,version),
  FOREIGN KEY(batch_id,group_id) REFERENCES media_group(batch_id,id),
  FOREIGN KEY(batch_id,observation_id) REFERENCES capture_observation(batch_id,id),
  CHECK((value->>'mode'='set') = (observation_id IS NOT NULL))
);
CREATE INDEX capture_group_location_latest ON capture_group_location(batch_id,group_id,version DESC);
CREATE TRIGGER capture_group_location_immutable BEFORE UPDATE OR DELETE ON capture_group_location
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
