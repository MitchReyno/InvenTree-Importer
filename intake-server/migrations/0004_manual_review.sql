-- T04 connects retained native capture to the independently retained executor.
-- Source enrollment is a constrained source-owner operation, never an approval grant.
CREATE FUNCTION manual_enroll_native_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE source_row public.capture_source%ROWTYPE; stored_key uuid;
BEGIN
  SELECT * INTO STRICT source_row FROM public.capture_source WHERE id=NEW.source_id;
  IF source_row.created_by IS DISTINCT FROM NEW.actor_id OR
     source_row.namespace_key IS DISTINCT FROM 'native_batch:' || source_row.id::text THEN
    RAISE EXCEPTION 'native_source_binding_invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.executor_source(target_id,source_id,original_key)
    VALUES(NEW.target_id,source_row.id,source_row.id) ON CONFLICT DO NOTHING;
  SELECT original_key INTO STRICT stored_key FROM public.executor_source
    WHERE target_id=NEW.target_id AND source_id=source_row.id;
  IF stored_key IS DISTINCT FROM source_row.id THEN
    RAISE EXCEPTION 'native_source_binding_conflict' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION manual_enroll_native_source() FROM PUBLIC;
CREATE TRIGGER manual_capture_source AFTER INSERT ON capture_batch
  FOR EACH ROW EXECUTE FUNCTION manual_enroll_native_source();
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.capture_batch b JOIN public.capture_source s ON s.id=b.source_id
    WHERE s.created_by IS DISTINCT FROM b.actor_id OR s.namespace_key IS DISTINCT FROM 'native_batch:' || s.id::text) OR
    EXISTS(SELECT 1 FROM public.capture_batch b JOIN public.executor_source e
      ON e.target_id=b.target_id AND e.source_id=b.source_id WHERE e.original_key IS DISTINCT FROM b.source_id) THEN
    RAISE EXCEPTION 'native_source_backfill_conflict';
  END IF;
  INSERT INTO public.executor_source(target_id,source_id,original_key)
    SELECT target_id,source_id,source_id FROM public.capture_batch ON CONFLICT DO NOTHING;
END;
$$;
ALTER TABLE capture_lot ADD UNIQUE(batch_id,id,source_id,contribution_key);
ALTER TABLE capture_batch ADD UNIQUE(id,target_id,target_context_id);
ALTER TABLE capture_batch ADD UNIQUE(id,stream_id);
ALTER TABLE capture_batch ADD UNIQUE(id,actor_id);
ALTER TABLE executor_approval ADD UNIQUE(id,preparation_id);
ALTER TABLE executor_approval ADD UNIQUE(id,preparation_id,actor_id);
ALTER TABLE executor_run ADD UNIQUE(id,approval_id);
CREATE TABLE manual_review (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES operator(id),
  dependency_bytes bytea NOT NULL CHECK(octet_length(dependency_bytes) BETWEEN 1 AND 245760),
  dependency_digest bytea NOT NULL CHECK(octet_length(dependency_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_subject(batch_id,id),
  FOREIGN KEY(batch_id,actor_id) REFERENCES capture_batch(id,actor_id),
  UNIQUE(batch_id,subject_id,id)
);
CREATE INDEX manual_review_subject ON manual_review(batch_id,subject_id,created_at DESC,id);
CREATE TABLE manual_prepare_command (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  actor_id uuid NOT NULL REFERENCES operator(id),
  deployment_id uuid NOT NULL,
  target_id uuid NOT NULL,
  context_id uuid NOT NULL,
  dependency_bytes bytea NOT NULL CHECK(octet_length(dependency_bytes) BETWEEN 1 AND 245760),
  dependency_digest bytea NOT NULL CHECK(octet_length(dependency_digest)=32),
  review_bytes bytea NOT NULL CHECK(octet_length(review_bytes) BETWEEN 1 AND 65536),
  review_digest bytea NOT NULL CHECK(octet_length(review_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,id),
  UNIQUE(batch_id,id,actor_id),
  FOREIGN KEY(batch_id,actor_id) REFERENCES capture_batch(id,actor_id),
  FOREIGN KEY(batch_id,target_id,context_id) REFERENCES capture_batch(id,target_id,target_context_id),
  FOREIGN KEY(deployment_id,target_id,context_id) REFERENCES executor_deployment(id,target_id,context_id)
);
CREATE TABLE manual_read_intent (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  prepare_command_id uuid NOT NULL,
  model text NOT NULL CHECK(model IN ('part','location')),
  pk text NOT NULL CHECK(pk ~ '^[1-9][0-9]{0,18}$' AND pk::numeric<=9223372036854775807),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(batch_id,prepare_command_id) REFERENCES manual_prepare_command(batch_id,id),
  UNIQUE(prepare_command_id,model,pk)
);
CREATE TABLE manual_read_result (
  intent_id uuid PRIMARY KEY REFERENCES manual_read_intent(id),
  outcome text NOT NULL CHECK(outcome IN ('found','unavailable')),
  receipt_bytes bytea NOT NULL CHECK(octet_length(receipt_bytes) BETWEEN 1 AND 8192),
  receipt_digest bytea NOT NULL CHECK(octet_length(receipt_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE manual_preparation (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  prepare_command_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES operator(id),
  target_revision bigint NOT NULL CHECK(target_revision>0),
  plan_bytes bytea NOT NULL CHECK(octet_length(plan_bytes) BETWEEN 1 AND 262144),
  plan_digest bytea NOT NULL CHECK(octet_length(plan_digest)=32),
  review_bytes bytea NOT NULL CHECK(octet_length(review_bytes) BETWEEN 1 AND 65536),
  review_digest bytea NOT NULL CHECK(octet_length(review_digest)=32),
  dependency_bytes bytea NOT NULL CHECK(octet_length(dependency_bytes) BETWEEN 1 AND 245760),
  dependency_digest bytea NOT NULL CHECK(octet_length(dependency_digest)=32),
  preview_bytes bytea NOT NULL CHECK(octet_length(preview_bytes) BETWEEN 1 AND 245760),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(batch_id,prepare_command_id,actor_id) REFERENCES manual_prepare_command(batch_id,id,actor_id),
  UNIQUE(batch_id,id),
  UNIQUE(batch_id,id,actor_id)
);
CREATE TABLE manual_preparation_review (
  batch_id uuid NOT NULL,
  preparation_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  review_id uuid NOT NULL,
  PRIMARY KEY(preparation_id,subject_id),
  FOREIGN KEY(batch_id,preparation_id) REFERENCES manual_preparation(batch_id,id),
  FOREIGN KEY(batch_id,subject_id,review_id) REFERENCES manual_review(batch_id,subject_id,id),
  UNIQUE(batch_id,preparation_id,subject_id,review_id)
);
CREATE TABLE manual_preparation_lot (
  batch_id uuid NOT NULL,
  preparation_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  review_id uuid NOT NULL,
  source_id uuid NOT NULL,
  contribution_key uuid NOT NULL,
  PRIMARY KEY(preparation_id,lot_id),
  FOREIGN KEY(batch_id,preparation_id,lot_id,review_id)
    REFERENCES manual_preparation_review(batch_id,preparation_id,subject_id,review_id),
  FOREIGN KEY(batch_id,lot_id,source_id,contribution_key)
    REFERENCES capture_lot(batch_id,id,source_id,contribution_key)
);
CREATE TABLE manual_prepare_outcome (
  command_id uuid PRIMARY KEY REFERENCES manual_prepare_command(id),
  response_bytes bytea NOT NULL CHECK(octet_length(response_bytes) BETWEEN 1 AND 245760),
  response_digest bytea NOT NULL CHECK(octet_length(response_digest)=32)
);
CREATE TABLE manual_approval (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  preparation_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES operator(id),
  round_number bigint NOT NULL CHECK(round_number>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(batch_id,preparation_id,actor_id) REFERENCES manual_preparation(batch_id,id,actor_id),
  FOREIGN KEY(id,preparation_id,actor_id) REFERENCES executor_approval(id,preparation_id,actor_id),
  UNIQUE(batch_id,id),
  UNIQUE(batch_id,id,actor_id),
  UNIQUE(batch_id,round_number)
);
CREATE TABLE manual_run (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  approval_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES operator(id),
  stream_id uuid NOT NULL REFERENCES ui_stream(id),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  UNIQUE(id,actor_id),
  FOREIGN KEY(batch_id,approval_id,actor_id) REFERENCES manual_approval(batch_id,id,actor_id),
  FOREIGN KEY(id,approval_id) REFERENCES executor_run(id,approval_id)
  ,FOREIGN KEY(batch_id,stream_id) REFERENCES capture_batch(id,stream_id)
);
CREATE TABLE manual_dispatch (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  run_id uuid NOT NULL REFERENCES manual_run(id),
  actor_id uuid NOT NULL REFERENCES operator(id),
  command_id uuid NOT NULL UNIQUE REFERENCES command(id),
  recovery_bytes bytea NOT NULL CHECK(octet_length(recovery_bytes) BETWEEN 2 AND 8192),
  recovery_digest bytea NOT NULL CHECK(octet_length(recovery_digest)=32),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','finished','interrupted')),
  safe_code text CHECK(safe_code ~ '^[a-z_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
  ,FOREIGN KEY(run_id,actor_id) REFERENCES manual_run(id,actor_id)
);
CREATE INDEX manual_dispatch_eligible ON manual_dispatch(created_at,id) WHERE state='queued';
CREATE FUNCTION manual_projection_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE selected_run uuid; selected_stream uuid; selected_revision bigint; selected_sequence bigint;
BEGIN
  IF TG_TABLE_NAME='executor_result' THEN
    SELECT run_id INTO STRICT selected_run FROM public.executor_intent WHERE id=NEW.intent_id;
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
REVOKE ALL ON FUNCTION manual_projection_event() FROM PUBLIC;
CREATE TRIGGER manual_intent_event AFTER INSERT ON executor_intent FOR EACH ROW EXECUTE FUNCTION manual_projection_event();
CREATE TRIGGER manual_result_event AFTER INSERT ON executor_result FOR EACH ROW EXECUTE FUNCTION manual_projection_event();
CREATE TRIGGER manual_effect_event AFTER INSERT ON executor_effect FOR EACH ROW EXECUTE FUNCTION manual_projection_event();
CREATE TRIGGER manual_cancel_event AFTER INSERT ON executor_cancel FOR EACH ROW EXECUTE FUNCTION manual_projection_event();
CREATE TRIGGER manual_recovery_event AFTER INSERT ON executor_recovery FOR EACH ROW EXECUTE FUNCTION manual_projection_event();
CREATE TRIGGER manual_dispatch_event AFTER INSERT OR UPDATE ON manual_dispatch FOR EACH ROW EXECUTE FUNCTION manual_projection_event();
CREATE FUNCTION manual_projection_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['revision','state','safe_code']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['revision','state','safe_code']) THEN
    RAISE EXCEPTION 'immutable_manual_identity' USING ERRCODE='23000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER manual_run_identity BEFORE UPDATE OR DELETE ON manual_run FOR EACH ROW EXECUTE FUNCTION manual_projection_identity();
CREATE TRIGGER manual_dispatch_identity BEFORE UPDATE OR DELETE ON manual_dispatch FOR EACH ROW EXECUTE FUNCTION manual_projection_identity();
CREATE TRIGGER manual_review_immutable BEFORE UPDATE OR DELETE ON manual_review FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_prepare_command_immutable BEFORE UPDATE OR DELETE ON manual_prepare_command FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_read_intent_immutable BEFORE UPDATE OR DELETE ON manual_read_intent FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_read_result_immutable BEFORE UPDATE OR DELETE ON manual_read_result FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_preparation_immutable BEFORE UPDATE OR DELETE ON manual_preparation FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_preparation_review_immutable BEFORE UPDATE OR DELETE ON manual_preparation_review FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_preparation_lot_immutable BEFORE UPDATE OR DELETE ON manual_preparation_lot FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_prepare_outcome_immutable BEFORE UPDATE OR DELETE ON manual_prepare_outcome FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER manual_approval_immutable BEFORE UPDATE OR DELETE ON manual_approval FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
