-- Additive retained evidence authority. Runtime history is append-only.
CREATE TABLE media_store_identity (
  singleton boolean PRIMARY KEY CHECK(singleton),
  store_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
INSERT INTO media_store_identity(singleton) VALUES(true);
CREATE TRIGGER media_store_identity_immutable BEFORE UPDATE OR DELETE ON media_store_identity
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TABLE media_batch (
  batch_id uuid PRIMARY KEY REFERENCES capture_batch(id),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE TABLE media_blob (
  digest bytea PRIMARY KEY CHECK(octet_length(digest)=32),
  byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 20971520),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media_group (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 256),
  actor_id uuid NOT NULL REFERENCES operator(id),
  UNIQUE(batch_id,id)
);
CREATE TABLE media_evidence (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 256),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,id)
);
CREATE TABLE media_version (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('original','derived')),
  blob_digest bytea NOT NULL REFERENCES media_blob(digest),
  media_type text NOT NULL CHECK(media_type IN ('image/jpeg','image/png','application/pdf','application/octet-stream')),
  source_version_id uuid,
  recipe_bytes bytea,
  recipe_digest bytea CHECK(recipe_digest IS NULL OR octet_length(recipe_digest)=32),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,id), UNIQUE(batch_id,evidence_id,id), UNIQUE(batch_id,id,blob_digest),
  FOREIGN KEY(batch_id,evidence_id) REFERENCES media_evidence(batch_id,id),
  FOREIGN KEY(batch_id,evidence_id,source_version_id) REFERENCES media_version(batch_id,evidence_id,id),
  CHECK((kind='original' AND source_version_id IS NULL AND recipe_bytes IS NULL AND recipe_digest IS NULL)
     OR (kind='derived' AND source_version_id IS NOT NULL AND recipe_bytes IS NOT NULL AND recipe_digest IS NOT NULL))
);
CREATE TABLE media_derivation (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  recipe_bytes bytea NOT NULL CHECK(octet_length(recipe_bytes) BETWEEN 1 AND 4096),
  recipe_digest bytea NOT NULL CHECK(octet_length(recipe_digest)=32),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,id), UNIQUE(batch_id,id,source_version_id),
  FOREIGN KEY(batch_id,evidence_id,source_version_id) REFERENCES media_version(batch_id,evidence_id,id)
);
CREATE TABLE media_decode_command (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  version_id uuid NOT NULL,
  derivation_id uuid UNIQUE,
  build text NOT NULL CHECK(length(build) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,id),
  FOREIGN KEY(batch_id,derivation_id,version_id) REFERENCES media_derivation(batch_id,id,source_version_id),
  FOREIGN KEY(batch_id,version_id) REFERENCES media_version(batch_id,id)
);
CREATE UNIQUE INDEX media_original_decode_once ON media_decode_command(version_id) WHERE derivation_id IS NULL;
-- Claim lifetime is not a retry lease. An interrupted claim requires explicit settlement.
CREATE TABLE media_decode_claim (
  command_id uuid PRIMARY KEY REFERENCES media_decode_command(id),
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media_decode_result (
  command_id uuid PRIMARY KEY REFERENCES media_decode_command(id),
  state text NOT NULL CHECK(state IN ('ready','unsupported','encrypted','malformed','limit_exceeded','interrupted')),
  decoder_build text NOT NULL CHECK(length(decoder_build) BETWEEN 1 AND 256),
  UNIQUE(command_id,state),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media_preview (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  version_id uuid NOT NULL,
  command_id uuid NOT NULL,
  decode_state text NOT NULL DEFAULT 'ready' CHECK(decode_state='ready'),
  page integer NOT NULL CHECK(page BETWEEN 1 AND 30),
  width integer NOT NULL CHECK(width BETWEEN 1 AND 24000000),
  height integer NOT NULL CHECK(height BETWEEN 1 AND 24000000),
  blob_digest bytea NOT NULL REFERENCES media_blob(digest),
  UNIQUE(batch_id,id), UNIQUE(version_id,page),
  FOREIGN KEY(command_id,decode_state) REFERENCES media_decode_result(command_id,state),
  FOREIGN KEY(batch_id,command_id) REFERENCES media_decode_command(batch_id,id),
  FOREIGN KEY(batch_id,version_id) REFERENCES media_version(batch_id,id),
  CHECK(width::bigint*height<=24000000)
);
CREATE TABLE media_group_selection (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  group_id uuid,
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  UNIQUE(batch_id,evidence_id,revision),
  FOREIGN KEY(batch_id,evidence_id) REFERENCES media_evidence(batch_id,id),
  FOREIGN KEY(batch_id,group_id) REFERENCES media_group(batch_id,id)
);
CREATE TABLE media_subject_link (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  linked boolean NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  UNIQUE(batch_id,evidence_id,subject_id,revision),
  FOREIGN KEY(batch_id,evidence_id) REFERENCES media_evidence(batch_id,id),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_subject(batch_id,id)
);
CREATE TABLE media_attachment_selection (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'lot' CHECK(subject_kind='lot'),
  mode text NOT NULL CHECK(mode IN ('selected','declined','unset')),
  version_id uuid,
  destination text NOT NULL CHECK(destination='lot_attachment'),
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  UNIQUE(batch_id,subject_id,revision),
  FOREIGN KEY(batch_id,subject_id,subject_kind) REFERENCES capture_subject(batch_id,id,kind),
  FOREIGN KEY(batch_id,version_id) REFERENCES media_version(batch_id,id),
  CHECK((mode='selected')=(version_id IS NOT NULL))
);
-- Pins include exact originals, derivatives and supporting evidence. No automatic unpin.
CREATE TABLE media_approval_pin (
  approval_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  original_key uuid NOT NULL,
  version_id uuid NOT NULL,
  blob_digest bytea NOT NULL REFERENCES media_blob(digest),
  PRIMARY KEY(approval_id,version_id,blob_digest),
  FOREIGN KEY(batch_id,source_id) REFERENCES capture_batch(id,source_id),
  FOREIGN KEY(approval_id,target_id,original_key) REFERENCES executor_approval(id,target_id,original_key),
  FOREIGN KEY(target_id,source_id,original_key) REFERENCES executor_source(target_id,source_id,original_key),
  FOREIGN KEY(batch_id,version_id,blob_digest) REFERENCES media_version(batch_id,id,blob_digest)
);
ALTER TABLE command ADD UNIQUE(id,actor_id,target_id,target_context_id);
ALTER TABLE capture_batch ADD UNIQUE(id,actor_id,target_id,target_context_id);
CREATE TABLE media_command_binding (
  command_id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  manifest_bytes bytea NOT NULL CHECK(octet_length(manifest_bytes) BETWEEN 1 AND 262144),
  manifest_digest bytea NOT NULL CHECK(octet_length(manifest_digest)=32),
  UNIQUE(command_id,batch_id),
  FOREIGN KEY(command_id,actor_id,target_id,target_context_id) REFERENCES command(id,actor_id,target_id,target_context_id),
  FOREIGN KEY(batch_id,actor_id,target_id,target_context_id) REFERENCES capture_batch(id,actor_id,target_id,target_context_id)
);
CREATE TABLE media_command_pin (
  command_id uuid NOT NULL REFERENCES command(id),
  batch_id uuid NOT NULL,
  version_id uuid NOT NULL,
  blob_digest bytea NOT NULL REFERENCES media_blob(digest),
  PRIMARY KEY(command_id,version_id,blob_digest),
  FOREIGN KEY(batch_id,version_id,blob_digest) REFERENCES media_version(batch_id,id,blob_digest),
  FOREIGN KEY(command_id,batch_id) REFERENCES media_command_binding(command_id,batch_id)
);
CREATE TABLE manual_preparation_media (
  batch_id uuid NOT NULL,
  preparation_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  manifest_bytes bytea NOT NULL CHECK(octet_length(manifest_bytes) BETWEEN 1 AND 262144),
  manifest_digest bytea NOT NULL CHECK(octet_length(manifest_digest)=32),
  PRIMARY KEY(batch_id,preparation_id,subject_id),
  FOREIGN KEY(batch_id,preparation_id,actor_id) REFERENCES manual_preparation(batch_id,id,actor_id),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_subject(batch_id,id)
);
CREATE TRIGGER media_batch_no_delete BEFORE DELETE ON media_batch
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER media_batch_identity BEFORE UPDATE OF batch_id ON media_batch
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['media_blob','media_group','media_evidence','media_version',
    'media_derivation','media_decode_command','media_decode_claim','media_decode_result','media_preview',
    'media_group_selection','media_subject_link','media_attachment_selection','media_approval_pin','media_command_binding','media_command_pin','manual_preparation_media']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_authority_change()',name||'_immutable',name);
  END LOOP;
END;
$$;

-- Additive owned-fake media executor. Existing stock-v1 rows and bytes are unchanged.
ALTER TABLE executor_deployment DROP CONSTRAINT executor_deployment_capability_check;
ALTER TABLE executor_deployment ADD CONSTRAINT executor_deployment_capability_check
  CHECK(capability IN ('owned-fake-stock/1','owned-fake-media/1'));
CREATE TABLE executor_attachment (
  run_id uuid NOT NULL,
  artifact_key uuid NOT NULL,
  stock_operation_key uuid NOT NULL,
  request_bytes bytea NOT NULL CHECK(octet_length(request_bytes) BETWEEN 1 AND 4096),
  request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
  PRIMARY KEY(run_id,artifact_key),
  FOREIGN KEY(run_id,stock_operation_key) REFERENCES executor_operation(run_id,operation_key)
);
CREATE TABLE executor_attachment_recovery (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  artifact_key uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES operator(id),
  cancel_version bigint NOT NULL CHECK(cancel_version>=0),
  kind text NOT NULL CHECK(kind IN ('repair_attachment','verify_attachment')),
  create_intent_id uuid,
  CHECK((kind='verify_attachment')=(create_intent_id IS NOT NULL)),
  FOREIGN KEY(run_id,artifact_key) REFERENCES executor_attachment(run_id,artifact_key),
  UNIQUE(id,run_id,artifact_key)
);
CREATE TABLE executor_attachment_intent (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  artifact_key uuid NOT NULL,
  attempt integer NOT NULL CHECK(attempt>0),
  recovery_id uuid,
  kind text NOT NULL CHECK(kind IN ('create_attachment','get_attachment','download_attachment','lookup_attachment','get_stock')),
  request_bytes bytea NOT NULL CHECK(octet_length(request_bytes) BETWEEN 1 AND 8192),
  request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,artifact_key) REFERENCES executor_attachment(run_id,artifact_key),
  FOREIGN KEY(recovery_id,run_id,artifact_key) REFERENCES executor_attachment_recovery(id,run_id,artifact_key),
  UNIQUE(run_id,artifact_key,kind,attempt),
  UNIQUE(id,run_id,artifact_key)
);
ALTER TABLE executor_attachment_recovery ADD FOREIGN KEY(create_intent_id,run_id,artifact_key)
  REFERENCES executor_attachment_intent(id,run_id,artifact_key);
CREATE TABLE executor_attachment_result (
  intent_id uuid PRIMARY KEY REFERENCES executor_attachment_intent(id),
  outcome text NOT NULL CHECK(outcome IN ('response','transport_loss','proven_not_sent')),
  status integer CHECK(status BETWEEN 100 AND 599),
  response_bytes bytea CHECK(octet_length(response_bytes)<=65536),
  response_digest bytea CHECK(octet_length(response_digest)=32),
  response_size bigint CHECK(response_size BETWEEN 0 AND 20979712),
  remote_pk text CHECK(remote_pk ~ '^[1-9][0-9]{0,18}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((outcome='response')=(status IS NOT NULL)),
  CHECK((outcome='response')=(response_digest IS NOT NULL AND response_size IS NOT NULL))
);
CREATE TABLE executor_attachment_effect (
  intent_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  artifact_key uuid NOT NULL,
  certainty text NOT NULL CHECK(certainty IN ('unknown','none')),
  remote_pk text CHECK(remote_pk ~ '^[1-9][0-9]{0,18}$'),
  FOREIGN KEY(intent_id,run_id,artifact_key) REFERENCES executor_attachment_intent(id,run_id,artifact_key),
  UNIQUE(intent_id,run_id,artifact_key)
);
CREATE TABLE executor_attachment_verification (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES executor_attachment_result(intent_id),
  create_intent_id uuid NOT NULL,
  run_id uuid NOT NULL,
  artifact_key uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('matches','missing_or_changed','unavailable')),
  remote_pk text CHECK(remote_pk ~ '^[1-9][0-9]{0,18}$'),
  verified_digest bytea CHECK(verified_digest IS NULL OR octet_length(verified_digest)=32),
  observed_stock_pk text CHECK(observed_stock_pk ~ '^[1-9][0-9]{0,18}$'),
  observed_artifact_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(intent_id,run_id,artifact_key) REFERENCES executor_attachment_intent(id,run_id,artifact_key),
  FOREIGN KEY(create_intent_id,run_id,artifact_key) REFERENCES executor_attachment_intent(id,run_id,artifact_key),
  CHECK(outcome<>'matches' OR (remote_pk IS NOT NULL AND verified_digest IS NOT NULL AND observed_stock_pk IS NOT NULL AND observed_artifact_key=artifact_key))
);
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['executor_attachment','executor_attachment_recovery',
    'executor_attachment_intent','executor_attachment_result','executor_attachment_effect',
    'executor_attachment_verification']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_authority_change()',name||'_immutable',name);
  END LOOP;
END;
$$;
CREATE FUNCTION manual_attachment_projection_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE selected_run uuid; selected_stream uuid; selected_revision bigint; selected_sequence bigint;
BEGIN
  IF TG_TABLE_NAME='executor_attachment_result' THEN
    SELECT run_id INTO STRICT selected_run FROM public.executor_attachment_intent WHERE id=NEW.intent_id;
  ELSE
    selected_run := NEW.run_id;
  END IF;
  UPDATE public.manual_run SET revision=revision+1 WHERE id=selected_run
    RETURNING stream_id,revision INTO selected_stream,selected_revision;
  IF selected_stream IS NOT NULL THEN
    UPDATE public.ui_stream SET head=head+1 WHERE id=selected_stream RETURNING head INTO selected_sequence;
    INSERT INTO public.ui_event(stream_id,sequence,kind,public_bytes)
      VALUES(selected_stream,selected_sequence,'manual_run_changed',
        pg_catalog.convert_to(pg_catalog.jsonb_build_object('run_id',selected_run::text,'revision',selected_revision::text)::text,'UTF8'));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION manual_attachment_projection_event() FROM PUBLIC;
CREATE TRIGGER manual_attachment_intent_event AFTER INSERT ON executor_attachment_intent FOR EACH ROW EXECUTE FUNCTION manual_attachment_projection_event();
CREATE TRIGGER manual_attachment_result_event AFTER INSERT ON executor_attachment_result FOR EACH ROW EXECUTE FUNCTION manual_attachment_projection_event();
CREATE TRIGGER manual_attachment_effect_event AFTER INSERT ON executor_attachment_effect FOR EACH ROW EXECUTE FUNCTION manual_attachment_projection_event();
CREATE TRIGGER manual_attachment_recovery_event AFTER INSERT ON executor_attachment_recovery FOR EACH ROW EXECUTE FUNCTION manual_attachment_projection_event();
CREATE TRIGGER manual_attachment_verification_event AFTER INSERT ON executor_attachment_verification FOR EACH ROW EXECUTE FUNCTION manual_attachment_projection_event();
