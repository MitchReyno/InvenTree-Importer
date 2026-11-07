-- Capture is independent of executor migration 0003. Archive never deletes history.
CREATE TABLE capture_source (
  id uuid PRIMARY KEY,
  namespace_key text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE capture_batch (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL UNIQUE REFERENCES capture_source(id),
  actor_id uuid NOT NULL REFERENCES operator(id),
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  stream_id uuid NOT NULL UNIQUE REFERENCES ui_stream(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,source_id),
  FOREIGN KEY(target_id,target_context_id) REFERENCES target_context(target_id,id)
);
CREATE INDEX capture_batch_recent ON capture_batch(actor_id,updated_at DESC,id);
CREATE TABLE capture_subject (
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN ('lot','part')),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 256),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  UNIQUE(batch_id,id), UNIQUE(batch_id,id,kind)
);
CREATE TABLE capture_part (
  batch_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'part' CHECK(kind='part'),
  UNIQUE(batch_id,id),
  FOREIGN KEY(batch_id,id,kind) REFERENCES capture_subject(batch_id,id,kind)
);
CREATE TABLE capture_lot (
  batch_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'lot' CHECK(kind='lot'),
  source_id uuid NOT NULL,
  contribution_key uuid NOT NULL,
  part_subject_id uuid,
  UNIQUE(source_id,contribution_key),
  FOREIGN KEY(batch_id,id,kind) REFERENCES capture_subject(batch_id,id,kind),
  FOREIGN KEY(batch_id,source_id) REFERENCES capture_batch(id,source_id),
  FOREIGN KEY(batch_id,part_subject_id) REFERENCES capture_part(batch_id,id)
);
CREATE FUNCTION capture_require_extension() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='lot' AND NOT EXISTS(SELECT 1 FROM capture_lot WHERE id=NEW.id) OR
     NEW.kind='part' AND NOT EXISTS(SELECT 1 FROM capture_part WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'missing_subject_extension' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER capture_subject_extension AFTER INSERT ON capture_subject
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION capture_require_extension();
CREATE TABLE capture_note (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  subject_id uuid,
  text text NOT NULL CHECK(length(text)<=8192),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_subject(batch_id,id)
);
CREATE INDEX capture_note_batch ON capture_note(batch_id,created_at,id);
CREATE TABLE capture_observation (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  model text NOT NULL CHECK(model IN ('part','location')),
  pk text NOT NULL CHECK(pk ~ '^[1-9][0-9]{0,18}$' AND pk::numeric<=9223372036854775807),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 256),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,id),
  FOREIGN KEY(target_id,target_context_id) REFERENCES target_context(target_id,id)
);
-- A small versioned field registry: quantity/location on lots or defaults, Part choice on Parts.
-- Missing edit members do not insert a revision. Every explicit selection retains its actor/version.
CREATE TABLE capture_selection (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  subject_id uuid,
  field text NOT NULL CHECK(field IN ('quantity','location','choice')),
  version bigint NOT NULL CHECK(version>0),
  value jsonb NOT NULL CHECK(jsonb_typeof(value)='object' AND value->>'mode' IN ('unset','unknown','clear','inherit','set')),
  observation_id uuid,
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(batch_id,subject_id,field,version),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_subject(batch_id,id),
  FOREIGN KEY(batch_id,observation_id) REFERENCES capture_observation(batch_id,id)
);
CREATE INDEX capture_selection_latest ON capture_selection(batch_id,subject_id,field,version DESC);
-- Exact immutable command history preserves original notes, choices and relationships after edits.
CREATE TABLE capture_revision (
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  command_bytes bytea NOT NULL CHECK(octet_length(command_bytes) BETWEEN 1 AND 262144),
  command_digest bytea NOT NULL CHECK(octet_length(command_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(batch_id,revision)
);
CREATE TRIGGER capture_source_immutable BEFORE UPDATE OR DELETE ON capture_source FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_note_immutable BEFORE UPDATE OR DELETE ON capture_note FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_observation_immutable BEFORE UPDATE OR DELETE ON capture_observation FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_selection_immutable BEFORE UPDATE OR DELETE ON capture_selection FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_revision_immutable BEFORE UPDATE OR DELETE ON capture_revision FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE FUNCTION capture_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['title','revision','archived','updated_at','label','part_subject_id'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['title','revision','archived','updated_at','label','part_subject_id']) THEN
    RAISE EXCEPTION 'immutable_capture_identity' USING ERRCODE='23000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_batch_identity BEFORE UPDATE OR DELETE ON capture_batch FOR EACH ROW EXECUTE FUNCTION capture_identity_immutable();
CREATE TRIGGER capture_subject_identity BEFORE UPDATE OR DELETE ON capture_subject FOR EACH ROW EXECUTE FUNCTION capture_identity_immutable();
CREATE TRIGGER capture_lot_identity BEFORE UPDATE OR DELETE ON capture_lot FOR EACH ROW EXECUTE FUNCTION capture_identity_immutable();
CREATE TRIGGER capture_part_immutable BEFORE UPDATE OR DELETE ON capture_part FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
