-- Independent of capture (0002). Executor indexes are a validated index of retained bytes,
-- never a second editable specification. Administrative DDL remains trusted.
CREATE TABLE executor_deployment (
  id uuid PRIMARY KEY,
  epoch uuid NOT NULL,
  target_id uuid NOT NULL UNIQUE REFERENCES target(id),
  context_id uuid NOT NULL,
  origin text NOT NULL UNIQUE,
  continuity text NOT NULL,
  build text NOT NULL,
  capability text NOT NULL CHECK (capability = 'owned-fake-stock/1'),
  FOREIGN KEY (target_id,context_id) REFERENCES target_context(target_id,id),
  UNIQUE(id,target_id,context_id)
);
CREATE TABLE executor_source (
  target_id uuid NOT NULL REFERENCES target(id),
  source_id uuid NOT NULL,
  original_key uuid NOT NULL,
  PRIMARY KEY(target_id,source_id),
  UNIQUE(target_id,source_id,original_key)
);
CREATE TABLE executor_guard (
  target_id uuid NOT NULL REFERENCES target(id),
  original_key uuid NOT NULL,
  active_run uuid,
  PRIMARY KEY(target_id,original_key)
);
CREATE TABLE executor_approval (
  id uuid PRIMARY KEY,
  preparation_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES operator(id),
  deployment_id uuid NOT NULL,
  target_id uuid NOT NULL,
  context_id uuid NOT NULL,
  source_id uuid NOT NULL,
  original_key uuid NOT NULL,
  plan_bytes bytea NOT NULL CHECK (octet_length(plan_bytes) BETWEEN 1 AND 262144),
  plan_digest bytea NOT NULL CHECK (octet_length(plan_digest)=32),
  FOREIGN KEY (deployment_id,target_id,context_id) REFERENCES executor_deployment(id,target_id,context_id),
  FOREIGN KEY (target_id,source_id,original_key) REFERENCES executor_source(target_id,source_id,original_key),
  UNIQUE(id,target_id,original_key)
);
CREATE TABLE executor_run (
  id uuid PRIMARY KEY,
  approval_id uuid NOT NULL UNIQUE,
  command_id uuid NOT NULL UNIQUE REFERENCES command(id),
  target_id uuid NOT NULL,
  original_key uuid NOT NULL,
  FOREIGN KEY (approval_id,target_id,original_key) REFERENCES executor_approval(id,target_id,original_key),
  FOREIGN KEY (target_id,original_key) REFERENCES executor_guard(target_id,original_key),
  UNIQUE(id,target_id,original_key)
);
ALTER TABLE executor_guard ADD CONSTRAINT executor_active_fk FOREIGN KEY (active_run,target_id,original_key)
  REFERENCES executor_run(id,target_id,original_key) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE executor_operation (
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  target_id uuid NOT NULL,
  original_key uuid NOT NULL,
  contribution_key uuid NOT NULL,
  request_bytes bytea NOT NULL CHECK (octet_length(request_bytes) BETWEEN 1 AND 8192),
  request_digest bytea NOT NULL CHECK (octet_length(request_digest)=32),
  PRIMARY KEY(run_id,operation_key),
  -- Even pending/no-effect approved work stays in its ORIGINAL run, forever.
  UNIQUE(target_id,original_key,contribution_key),
  UNIQUE(target_id,contribution_key),
  FOREIGN KEY (run_id,target_id,original_key) REFERENCES executor_run(id,target_id,original_key)
);
CREATE TABLE executor_cancel (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES executor_run(id),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE executor_recovery (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES operator(id),
  cancel_version bigint NOT NULL CHECK (cancel_version >= 0),
  -- Only untouched work or a positively recorded pre-dispatch refusal.
  kind text NOT NULL CHECK (kind IN ('resume_pending','resume_no_effect')),
  FOREIGN KEY (run_id,operation_key) REFERENCES executor_operation(run_id,operation_key),
  UNIQUE(id,run_id,operation_key)
);
CREATE TABLE executor_intent (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  recovery_id uuid,
  kind text NOT NULL CHECK (kind IN ('get_part','get_location','get_stock','create_stock')),
  request_bytes bytea NOT NULL CHECK (octet_length(request_bytes) BETWEEN 1 AND 8192),
  request_digest bytea NOT NULL CHECK (octet_length(request_digest)=32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id,operation_key) REFERENCES executor_operation(run_id,operation_key),
  FOREIGN KEY (recovery_id,run_id,operation_key) REFERENCES executor_recovery(id,run_id,operation_key),
  UNIQUE(run_id,operation_key,kind,attempt),
  UNIQUE(id,run_id,operation_key)
);
CREATE TABLE executor_result (
  intent_id uuid PRIMARY KEY REFERENCES executor_intent(id),
  outcome text NOT NULL CHECK (outcome IN ('response','transport_loss','proven_not_sent')),
  status integer CHECK (status BETWEEN 100 AND 599),
  response_bytes bytea CHECK (octet_length(response_bytes) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome='response') = (status IS NOT NULL))
);
CREATE TABLE executor_effect (
  intent_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  certainty text NOT NULL CHECK (certainty IN ('confirmed','unknown','none')),
  remote_pk text CHECK (remote_pk ~ '^[1-9][0-9]{0,18}$'),
  FOREIGN KEY (intent_id,run_id,operation_key) REFERENCES executor_intent(id,run_id,operation_key),
  UNIQUE(intent_id,run_id,operation_key),
  CHECK (certainty <> 'confirmed' OR remote_pk IS NOT NULL)
);
CREATE TABLE executor_verification (
  intent_id uuid PRIMARY KEY REFERENCES executor_result(intent_id),
  effect_intent_id uuid NOT NULL,
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  FOREIGN KEY (intent_id,run_id,operation_key) REFERENCES executor_intent(id,run_id,operation_key),
  FOREIGN KEY (effect_intent_id,run_id,operation_key) REFERENCES executor_effect(intent_id,run_id,operation_key),
  outcome text NOT NULL CHECK (outcome IN ('matches','missing_or_changed','unavailable'))
);
CREATE INDEX executor_intents_run ON executor_intent(run_id,operation_key,attempt);
CREATE INDEX executor_effects_run ON executor_effect(run_id,certainty);
CREATE TRIGGER executor_deployment_immutable BEFORE UPDATE OR DELETE ON executor_deployment FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_source_immutable BEFORE UPDATE OR DELETE ON executor_source FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_guard_retained BEFORE DELETE ON executor_guard FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_guard_identity_immutable BEFORE UPDATE OF target_id,original_key ON executor_guard FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_approval_immutable BEFORE UPDATE OR DELETE ON executor_approval FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_run_immutable BEFORE UPDATE OR DELETE ON executor_run FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_operation_immutable BEFORE UPDATE OR DELETE ON executor_operation FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_cancel_immutable BEFORE UPDATE OR DELETE ON executor_cancel FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_recovery_immutable BEFORE UPDATE OR DELETE ON executor_recovery FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_intent_immutable BEFORE UPDATE OR DELETE ON executor_intent FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_result_immutable BEFORE UPDATE OR DELETE ON executor_result FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_effect_immutable BEFORE UPDATE OR DELETE ON executor_effect FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER executor_verification_immutable BEFORE UPDATE OR DELETE ON executor_verification FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
