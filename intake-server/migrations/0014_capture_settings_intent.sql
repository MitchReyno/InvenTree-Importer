-- Additive batch settings intent. Every record is append-only human intent, never an effect.
CREATE TABLE capture_settings_intent (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  version bigint NOT NULL CHECK(version>0),
  value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
  default_location_draft_id uuid,
  default_location_draft_kind text CHECK(default_location_draft_kind='location'),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,version),
  CHECK((default_location_draft_id IS NULL) = (default_location_draft_kind IS NULL))
);
CREATE INDEX capture_settings_intent_latest ON capture_settings_intent(batch_id,version DESC);
CREATE TABLE capture_setting_note (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  scope text NOT NULL CHECK(scope IN ('batch','order')),
  version bigint NOT NULL CHECK(version>0),
  text text CHECK(text IS NULL OR length(text) BETWEEN 1 AND 8192),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,scope,version)
);
CREATE INDEX capture_setting_note_latest ON capture_setting_note(batch_id,scope,version DESC);
CREATE TABLE capture_reference_draft_identity (
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  draft_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('location','company')),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(batch_id,draft_id),
  UNIQUE(batch_id,draft_id,kind)
);
ALTER TABLE capture_settings_intent ADD FOREIGN KEY(batch_id,default_location_draft_id,default_location_draft_kind)
  REFERENCES capture_reference_draft_identity(batch_id,draft_id,kind);
CREATE TABLE capture_reference_draft (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  kind text NOT NULL,
  version bigint NOT NULL CHECK(version>0),
  value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
  retired boolean NOT NULL,
  logo_evidence_id uuid,
  logo_version_id uuid,
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,draft_id,version),
  FOREIGN KEY(batch_id,draft_id,kind) REFERENCES capture_reference_draft_identity(batch_id,draft_id,kind),
  FOREIGN KEY(batch_id,logo_evidence_id,logo_version_id) REFERENCES media_version(batch_id,evidence_id,id),
  CHECK((logo_evidence_id IS NULL) = (logo_version_id IS NULL)),
  CHECK(kind='company' OR logo_evidence_id IS NULL)
);
CREATE INDEX capture_reference_draft_latest ON capture_reference_draft(batch_id,draft_id,version DESC);
CREATE TRIGGER capture_settings_intent_immutable BEFORE UPDATE OR DELETE ON capture_settings_intent
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_setting_note_immutable BEFORE UPDATE OR DELETE ON capture_setting_note
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_reference_draft_identity_immutable BEFORE UPDATE OR DELETE ON capture_reference_draft_identity
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER capture_reference_draft_immutable BEFORE UPDATE OR DELETE ON capture_reference_draft
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
