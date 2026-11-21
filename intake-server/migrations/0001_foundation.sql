CREATE TABLE operator (
  id uuid PRIMARY KEY,
  identity_kind text NOT NULL CHECK (identity_kind = 'development'),
  subject_key text NOT NULL UNIQUE CHECK (length(subject_key) BETWEEN 1 AND 128)
);
CREATE TABLE target (
  id uuid PRIMARY KEY,
  current_context_id uuid,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  profile text NOT NULL CHECK (profile IN ('protected-read-only','owned-disposable'))
);
CREATE TABLE target_context (
  id uuid PRIMARY KEY,
  target_id uuid NOT NULL REFERENCES target(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK (generation > 0),
  context_digest bytea NOT NULL CHECK (octet_length(context_digest) = 32),
  UNIQUE(target_id,id), UNIQUE(target_id,generation)
);
ALTER TABLE target ADD CONSTRAINT target_current_context_fk
  FOREIGN KEY (id,current_context_id) REFERENCES target_context(target_id,id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE command (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES operator(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('process','continue','prepare','apply','cancel','recover','qualification')),
  handler_version text NOT NULL CHECK (length(handler_version) BETWEEN 1 AND 128),
  workflow_id text NOT NULL UNIQUE CHECK (length(workflow_id) BETWEEN 1 AND 256),
  queue_name text NOT NULL CHECK (length(queue_name) BETWEEN 1 AND 128),
  payload_bytes bytea NOT NULL CHECK (octet_length(payload_bytes) BETWEEN 1 AND 262144),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (target_id,target_context_id) REFERENCES target_context(target_id,id) ON DELETE RESTRICT
);
CREATE TABLE outbox (
  command_id uuid PRIMARY KEY REFERENCES command(id) ON DELETE RESTRICT,
  available_at timestamptz NOT NULL DEFAULT now(),
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  acked_at timestamptz,
  conflict_code text CHECK (conflict_code IN ('payload_conflict','version_conflict'))
);
CREATE INDEX outbox_eligible ON outbox(available_at,command_id) WHERE acked_at IS NULL AND conflict_code IS NULL;
CREATE TABLE idempotency_record (
  actor_id uuid NOT NULL REFERENCES operator(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
  resource_key text NOT NULL CHECK (length(resource_key) BETWEEN 1 AND 256),
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
  semantic_bytes bytea NOT NULL CHECK (octet_length(semantic_bytes) BETWEEN 1 AND 262144),
  semantic_digest bytea NOT NULL CHECK (octet_length(semantic_digest) = 32),
  response_bytes bytea NOT NULL CHECK (octet_length(response_bytes) BETWEEN 1 AND 262144),
  PRIMARY KEY(actor_id,action,resource_key,key)
);
CREATE TABLE ui_stream (
  id uuid PRIMARY KEY,
  stream_key text NOT NULL UNIQUE CHECK (length(stream_key) BETWEEN 1 AND 256),
  head bigint NOT NULL DEFAULT 0 CHECK (head >= 0)
);
CREATE TABLE ui_event (
  stream_id uuid NOT NULL REFERENCES ui_stream(id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 128),
  public_bytes bytea NOT NULL CHECK (octet_length(public_bytes) BETWEEN 1 AND 262144),
  PRIMARY KEY(stream_id,sequence)
);
-- Immutable authority is append-only even for the migration owner during ordinary commands.
-- Administrative DDL can bypass this; DBA access is explicitly outside the authority boundary.
CREATE FUNCTION reject_authority_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable_authority' USING ERRCODE = '23000'; END;
$$;
CREATE TRIGGER command_immutable BEFORE UPDATE OR DELETE ON command FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER context_immutable BEFORE UPDATE OR DELETE ON target_context FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER idempotency_immutable BEFORE UPDATE OR DELETE ON idempotency_record FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER event_immutable BEFORE UPDATE OR DELETE ON ui_event FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
