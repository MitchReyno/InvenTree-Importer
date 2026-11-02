-- Additive effects authority; old plan bytes and migration history remain immutable.
ALTER TABLE media_attachment_selection DROP CONSTRAINT media_attachment_selection_destination_check;
ALTER TABLE media_attachment_selection ADD CONSTRAINT media_attachment_selection_destination_check CHECK(destination IN ('lot_attachment','part_attachment'));
ALTER TABLE executor_deployment DROP CONSTRAINT executor_deployment_capability_check;
ALTER TABLE executor_deployment ADD CONSTRAINT executor_deployment_capability_check CHECK(capability IN ('owned-fake-stock/1','owned-fake-media/1','owned-fake-effects/1'));
ALTER TABLE capture_observation DROP CONSTRAINT capture_observation_model_check;
ALTER TABLE capture_observation ADD CONSTRAINT capture_observation_model_check CHECK(model IN ('part','location','category','parameter_template','category_parameter','company'));
ALTER TABLE capture_observation ADD COLUMN mapping jsonb;
ALTER TABLE capture_selection DROP CONSTRAINT capture_selection_value_check;
ALTER TABLE capture_selection ADD CONSTRAINT capture_selection_value_check CHECK(jsonb_typeof(value)='object' AND value->>'mode' IN ('unset','unknown','clear','inherit','set','create'));
ALTER TABLE manual_read_intent DROP CONSTRAINT manual_read_intent_model_check;
ALTER TABLE manual_read_intent ADD CONSTRAINT manual_read_intent_model_check CHECK(model IN ('part','location','category','parameter_template','category_parameter','company'));
CREATE TABLE executor_supported_operation (
  run_id uuid NOT NULL REFERENCES executor_run(id),
  operation_key uuid NOT NULL,
  part_subject_id uuid,
  kind text NOT NULL CHECK(kind IN ('create_part','parameter','manufacturer','supplier','part_attachment','create_stock')),
  spec_bytes bytea NOT NULL CHECK(octet_length(spec_bytes) BETWEEN 1 AND 16384),
  spec_digest bytea NOT NULL CHECK(octet_length(spec_digest)=32),
  PRIMARY KEY(run_id,operation_key)
);
CREATE TABLE executor_part_transfer (
  target_id uuid NOT NULL,
  original_key uuid NOT NULL,
  part_subject_id uuid NOT NULL,
  destination_key text NOT NULL CHECK(length(destination_key) BETWEEN 1 AND 256),
  version_id uuid NOT NULL,
  blob_digest bytea NOT NULL CHECK(octet_length(blob_digest)=32),
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  artifact_key uuid NOT NULL,
  PRIMARY KEY(target_id,original_key,part_subject_id,destination_key,version_id,blob_digest),
  FOREIGN KEY(run_id,target_id,original_key) REFERENCES executor_run(id,target_id,original_key),
  FOREIGN KEY(run_id,operation_key) REFERENCES executor_supported_operation(run_id,operation_key)
);
CREATE TABLE executor_part_identity (
  target_id uuid NOT NULL,
  original_key uuid NOT NULL,
  part_subject_id uuid NOT NULL,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  spec_digest bytea NOT NULL CHECK(octet_length(spec_digest)=32),
  PRIMARY KEY(target_id,original_key,part_subject_id),
  FOREIGN KEY(run_id,target_id,original_key) REFERENCES executor_run(id,target_id,original_key),
  FOREIGN KEY(run_id,operation_key) REFERENCES executor_supported_operation(run_id,operation_key)
);
CREATE TABLE executor_supported_recovery (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES operator(id),
  cancel_version bigint NOT NULL CHECK(cancel_version>=0),
  kind text NOT NULL CHECK(kind IN ('resume_effect','verify_effect')),
  FOREIGN KEY(run_id,operation_key) REFERENCES executor_supported_operation(run_id,operation_key),
  UNIQUE(id,run_id,operation_key)
);
CREATE TABLE executor_supported_intent (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  recovery_id uuid,
  kind text NOT NULL CHECK(kind IN ('read','create','verify')),
  attempt integer NOT NULL CHECK(attempt>0),
  request_bytes bytea NOT NULL CHECK(octet_length(request_bytes) BETWEEN 1 AND 16384),
  request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,operation_key) REFERENCES executor_supported_operation(run_id,operation_key),
  FOREIGN KEY(recovery_id,run_id,operation_key) REFERENCES executor_supported_recovery(id,run_id,operation_key),
  UNIQUE(run_id,operation_key,kind,attempt),
  UNIQUE(id,run_id,operation_key)
);
CREATE TABLE executor_supported_result (
  intent_id uuid PRIMARY KEY REFERENCES executor_supported_intent(id),
  outcome text NOT NULL CHECK(outcome IN ('response','transport_loss','proven_not_sent')),
  status integer CHECK(status BETWEEN 100 AND 599),
  response_bytes bytea CHECK(octet_length(response_bytes)<=65536),
  response_digest bytea CHECK(octet_length(response_digest)=32),
  response_size bigint CHECK(response_size BETWEEN 0 AND 20979712),
  CHECK((outcome='response')=(response_digest IS NOT NULL AND response_size IS NOT NULL)),
  CHECK((outcome='response')=(status IS NOT NULL))
);
CREATE FUNCTION supported_remote_pks_valid(values_to_check text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT COALESCE(bool_and(value IS NOT NULL AND value ~ '^[1-9][0-9]{0,18}$'
    AND (length(value)<19 OR value<='9223372036854775807')),true)
  FROM unnest(values_to_check) AS value;
$$;
CREATE TABLE executor_supported_effect (
  intent_id uuid PRIMARY KEY REFERENCES executor_supported_result(intent_id),
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  certainty text NOT NULL CHECK(certainty IN ('none','unknown','confirmed')),
  remote_pks text[] NOT NULL CHECK(supported_remote_pks_valid(remote_pks)),
  FOREIGN KEY(intent_id,run_id,operation_key) REFERENCES executor_supported_intent(id,run_id,operation_key),
  CHECK(certainty<>'confirmed' OR cardinality(remote_pks)=1),
  UNIQUE(intent_id,run_id,operation_key)
);
CREATE TABLE executor_supported_assessment (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES executor_supported_result(intent_id),
  create_intent_id uuid NOT NULL,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('matches','missing_or_changed','unavailable')),
  metadata_intent_id uuid,
  verified_digest bytea CHECK(verified_digest IS NULL OR octet_length(verified_digest)=32),
  observed_model_id text CHECK(observed_model_id ~ '^[1-9][0-9]{0,18}$'),
  FOREIGN KEY(metadata_intent_id,run_id,operation_key) REFERENCES executor_supported_intent(id,run_id,operation_key),
  remote_pk text NOT NULL CHECK(remote_pk ~ '^[1-9][0-9]{0,18}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(intent_id,run_id,operation_key) REFERENCES executor_supported_intent(id,run_id,operation_key),
  FOREIGN KEY(create_intent_id,run_id,operation_key) REFERENCES executor_supported_effect(intent_id,run_id,operation_key)
);
CREATE TABLE manual_transfer_read_intent (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  prepare_command_id uuid NOT NULL,
  transfer_key uuid NOT NULL,
  target_id uuid NOT NULL,
  context_id uuid NOT NULL,
  original_key uuid NOT NULL,
  part_subject_id uuid NOT NULL,
  destination_key text NOT NULL CHECK(length(destination_key) BETWEEN 1 AND 256),
  version_id uuid NOT NULL,
  blob_digest bytea NOT NULL CHECK(octet_length(blob_digest)=32),
  original_run_id uuid NOT NULL,
  original_operation_key uuid NOT NULL,
  original_intent_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('metadata','file')),
  metadata_parent_id uuid,
  request_bytes bytea NOT NULL CHECK(octet_length(request_bytes) BETWEEN 1 AND 8192),
  request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
  FOREIGN KEY(batch_id,prepare_command_id) REFERENCES manual_prepare_command(batch_id,id),
  FOREIGN KEY(batch_id,part_subject_id) REFERENCES capture_subject(batch_id,id),
  FOREIGN KEY(target_id,context_id) REFERENCES target_context(target_id,id),
  FOREIGN KEY(original_run_id,target_id,original_key) REFERENCES executor_run(id,target_id,original_key),
  FOREIGN KEY(original_intent_id,original_run_id,original_operation_key) REFERENCES executor_supported_effect(intent_id,run_id,operation_key),
  UNIQUE(id,batch_id,prepare_command_id,transfer_key),
  FOREIGN KEY(metadata_parent_id,batch_id,prepare_command_id,transfer_key) REFERENCES manual_transfer_read_intent(id,batch_id,prepare_command_id,transfer_key),
  CHECK((kind='file')=(metadata_parent_id IS NOT NULL))
);
CREATE TABLE manual_transfer_read_result (
  intent_id uuid PRIMARY KEY REFERENCES manual_transfer_read_intent(id),
  outcome text NOT NULL CHECK(outcome IN ('verified','unavailable')),
  status integer CHECK(status BETWEEN 100 AND 599),
  response_bytes bytea CHECK(octet_length(response_bytes)<=65536),
  response_digest bytea CHECK(octet_length(response_digest)=32),
  response_size bigint CHECK(response_size BETWEEN 0 AND 20971520),
  receipt_bytes bytea NOT NULL CHECK(octet_length(receipt_bytes) BETWEEN 1 AND 8192),
  receipt_digest bytea NOT NULL CHECK(octet_length(receipt_digest)=32),
  CHECK((response_digest IS NULL)=(response_size IS NULL)),
  CHECK(outcome<>'verified' OR (status=200 AND response_digest IS NOT NULL))
);
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['executor_supported_operation','executor_part_transfer','executor_part_identity','executor_supported_recovery','executor_supported_intent','executor_supported_result','executor_supported_effect','executor_supported_assessment','manual_transfer_read_intent','manual_transfer_read_result'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_authority_change()',name||'_immutable',name);
  END LOOP;
END;
$$;
CREATE FUNCTION manual_supported_projection_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_run uuid; selected_stream uuid; selected_revision bigint; selected_sequence bigint;
BEGIN
  IF TG_TABLE_NAME='executor_supported_result' THEN
    SELECT run_id INTO STRICT selected_run FROM public.executor_supported_intent WHERE id=NEW.intent_id;
  ELSE selected_run := NEW.run_id;
  END IF;
  UPDATE public.manual_run SET revision=revision+1 WHERE id=selected_run RETURNING stream_id,revision INTO selected_stream,selected_revision;
  IF selected_stream IS NOT NULL THEN
    UPDATE public.ui_stream SET head=head+1 WHERE id=selected_stream RETURNING head INTO selected_sequence;
    INSERT INTO public.ui_event(stream_id,sequence,kind,public_bytes) VALUES(selected_stream,selected_sequence,'manual_run_changed',pg_catalog.convert_to(pg_catalog.jsonb_build_object('run_id',selected_run::text,'revision',selected_revision::text)::text,'UTF8'));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION manual_supported_projection_event() FROM PUBLIC;
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['executor_supported_intent','executor_supported_result','executor_supported_effect','executor_supported_assessment','executor_supported_recovery'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION manual_supported_projection_event()',name||'_event',name);
  END LOOP;
END;
$$;
