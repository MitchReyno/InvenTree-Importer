-- Processing owns no inventory or provider credential. Inputs and accepted evidence are append-only.
CREATE TABLE processing_profile (
  id text PRIMARY KEY CHECK (id = 'synthetic-research/1'),
  qualification text NOT NULL CHECK (qualification = 'fixture_only'),
  handler_version text NOT NULL CHECK (handler_version = 'processing/1'),
  instruction_bytes bytea NOT NULL,
  instruction_digest bytea NOT NULL CHECK(octet_length(instruction_digest)=32),
  tool_profile_version text NOT NULL CHECK(tool_profile_version='restricted-no-tools/1')
);
INSERT INTO processing_profile VALUES ('synthetic-research/1','fixture_only','processing/1',
  convert_to('Synthetic fixture only. Read staged manual evidence. Emit bounded proposals or application questions. Do not select human values, approve effects, access inventory writes or replay native permission handles.','UTF8'),
  decode('20902b83a2b36fcb0527f8376322275a78786671ddedb77f2bb1b177ba06c5f4','hex'),'restricted-no-tools/1');
CREATE TABLE processing_input (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id) ON DELETE RESTRICT,
  parent_id uuid,
  capture_revision bigint NOT NULL CHECK (capture_revision > 0),
  manifest_bytes bytea NOT NULL CHECK (octet_length(manifest_bytes) BETWEEN 1 AND 245760),
  manifest_digest bytea NOT NULL CHECK (octet_length(manifest_digest)=32),
  UNIQUE(batch_id,id),
  FOREIGN KEY(batch_id,parent_id) REFERENCES processing_input(batch_id,id) ON DELETE RESTRICT
);
CREATE TABLE processing_job (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('reading','identifying','research','images','inventory')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
  current_attempt_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','running','waiting_for_user','waiting_for_login','waiting_for_capacity','ready','failed','cancelled','superseded','interrupted')),
  UNIQUE(batch_id,subject_id,stage), UNIQUE(batch_id,id),
  FOREIGN KEY(batch_id,subject_id) REFERENCES capture_subject(batch_id,id) ON DELETE RESTRICT
);
CREATE TABLE processing_attempt (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  job_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number>0),
  input_id uuid NOT NULL,
  profile_id text NOT NULL REFERENCES processing_profile(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL UNIQUE REFERENCES command(id) ON DELETE RESTRICT,
  channel_digest bytea NOT NULL CHECK (octet_length(channel_digest)=32),
  state text NOT NULL CHECK (state IN ('queued','running','waiting_for_user','waiting_for_login','waiting_for_capacity','ready','failed','cancelled','superseded','interrupted')),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
  UNIQUE(job_id,id), UNIQUE(job_id,number), UNIQUE(batch_id,id), UNIQUE(id,input_id),
  FOREIGN KEY(batch_id,job_id) REFERENCES processing_job(batch_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(batch_id,input_id) REFERENCES processing_input(batch_id,id) ON DELETE RESTRICT
);
ALTER TABLE processing_job ADD CONSTRAINT processing_current_attempt_fk
  FOREIGN KEY(id,current_attempt_id) REFERENCES processing_attempt(job_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE processing_dependency (
  batch_id uuid NOT NULL,
  attempt_id uuid NOT NULL REFERENCES processing_attempt(id) ON DELETE RESTRICT,
  dependency_attempt_id uuid NOT NULL REFERENCES processing_attempt(id) ON DELETE RESTRICT,
  PRIMARY KEY(attempt_id,dependency_attempt_id),
  FOREIGN KEY(batch_id,attempt_id) REFERENCES processing_attempt(batch_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(batch_id,dependency_attempt_id) REFERENCES processing_attempt(batch_id,id) ON DELETE RESTRICT,
  CHECK(attempt_id<>dependency_attempt_id)
);
CREATE TABLE processing_lane (
  actor_id uuid PRIMARY KEY REFERENCES operator(id) ON DELETE RESTRICT,
  attempt_id uuid UNIQUE REFERENCES processing_attempt(id) ON DELETE RESTRICT
);
CREATE TABLE processing_message (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES processing_attempt(id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK(sequence>0),
  envelope_bytes bytea NOT NULL CHECK(octet_length(envelope_bytes) BETWEEN 1 AND 32768),
  envelope_digest bytea NOT NULL CHECK(octet_length(envelope_digest)=32),
  disposition text NOT NULL CHECK(disposition IN ('accepted','stale')),
  UNIQUE(attempt_id,sequence), UNIQUE(attempt_id,id)
);
CREATE TABLE processing_proposal (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL,
  message_id uuid NOT NULL UNIQUE,
  value_bytes bytea NOT NULL,
  value_digest bytea NOT NULL CHECK(octet_length(value_digest)=32),
  FOREIGN KEY(attempt_id,message_id) REFERENCES processing_message(attempt_id,id) ON DELETE RESTRICT
);
CREATE TABLE processing_question (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  message_id uuid NOT NULL UNIQUE,
  input_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  state text NOT NULL CHECK(state IN ('open','answered','superseded')),
  spec_bytes bytea NOT NULL,
  spec_digest bytea NOT NULL CHECK(octet_length(spec_digest)=32),
  UNIQUE(batch_id,id), UNIQUE(job_id,id),
  FOREIGN KEY(batch_id,job_id) REFERENCES processing_job(batch_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(job_id,attempt_id) REFERENCES processing_attempt(job_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id,message_id) REFERENCES processing_message(attempt_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id,input_id) REFERENCES processing_attempt(id,input_id) ON DELETE RESTRICT,
  FOREIGN KEY(batch_id,input_id) REFERENCES processing_input(batch_id,id) ON DELETE RESTRICT
);
CREATE TABLE processing_answer (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  question_id uuid NOT NULL UNIQUE REFERENCES processing_question(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES operator(id) ON DELETE RESTRICT,
  value_bytes bytea NOT NULL,
  value_digest bytea NOT NULL CHECK(octet_length(value_digest)=32),
  continuation_attempt_id uuid NOT NULL REFERENCES processing_attempt(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(job_id,question_id) REFERENCES processing_question(job_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(job_id,continuation_attempt_id) REFERENCES processing_attempt(job_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER processing_profile_immutable BEFORE UPDATE OR DELETE ON processing_profile FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER processing_input_immutable BEFORE UPDATE OR DELETE ON processing_input FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER processing_dependency_immutable BEFORE UPDATE OR DELETE ON processing_dependency FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER processing_message_immutable BEFORE UPDATE OR DELETE ON processing_message FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER processing_proposal_immutable BEFORE UPDATE OR DELETE ON processing_proposal FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER processing_answer_immutable BEFORE UPDATE OR DELETE ON processing_answer FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TABLE processing_transition (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES processing_attempt(id) ON DELETE RESTRICT,
  previous_state text,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION retain_processing_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.processing_transition(attempt_id,previous_state,state) VALUES(NEW.id,NULL,NEW.state);
  ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
    INSERT INTO public.processing_transition(attempt_id,previous_state,state) VALUES(NEW.id,OLD.state,NEW.state);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER processing_attempt_transition AFTER INSERT OR UPDATE OF state ON processing_attempt
  FOR EACH ROW EXECUTE FUNCTION retain_processing_transition();
CREATE TRIGGER processing_transition_immutable BEFORE UPDATE OR DELETE ON processing_transition FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

REVOKE ALL ON FUNCTION retain_processing_transition() FROM PUBLIC;
-- A caller-transaction capture edit cannot commit without its final stream publication.
CREATE TABLE capture_edit_publication (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id) ON DELETE RESTRICT
);
CREATE FUNCTION require_capture_edit_publication() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.capture_edit_publication WHERE id=NEW.id) THEN
    RAISE EXCEPTION 'capture_publication_required' USING ERRCODE='23000';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION require_capture_edit_publication() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER capture_edit_publication_required AFTER INSERT ON capture_edit_publication
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_capture_edit_publication();
CREATE FUNCTION require_processing_dependency_order() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE predecessor_stage text; successor_stage text; ordered_stages text[];
BEGIN
  ordered_stages := ARRAY['reading','identifying','research','images','inventory'];
  SELECT job.stage INTO predecessor_stage FROM public.processing_attempt attempt
    JOIN public.processing_job job ON job.id=attempt.job_id WHERE attempt.id=NEW.dependency_attempt_id;
  SELECT job.stage INTO successor_stage FROM public.processing_attempt attempt
    JOIN public.processing_job job ON job.id=attempt.job_id WHERE attempt.id=NEW.attempt_id;
  IF array_position(ordered_stages,predecessor_stage) >= array_position(ordered_stages,successor_stage) THEN
    RAISE EXCEPTION 'processing_dependency_order' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION require_processing_dependency_order() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER processing_dependency_order AFTER INSERT ON processing_dependency
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_processing_dependency_order();
