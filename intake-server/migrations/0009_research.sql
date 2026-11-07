-- Additive restricted fixture profile; existing sealed profiles remain unchanged.
ALTER TABLE processing_profile
  DROP CONSTRAINT processing_profile_version_pair_check,
  DROP CONSTRAINT processing_profile_tool_profile_version_check,
  ADD CONSTRAINT processing_profile_version_pair_check CHECK (
    (id = 'synthetic-research/1' AND handler_version = 'processing/1'
      AND tool_profile_version = 'restricted-no-tools/1')
    OR (id = 'synthetic-research/2' AND handler_version = 'processing/2'
      AND tool_profile_version = 'restricted-no-tools/1')
    OR (id = 'restricted-research-stub/1' AND handler_version = 'processing/3'
      AND tool_profile_version = 'restricted-research-tools/1')
  );

INSERT INTO processing_profile (
  id, qualification, handler_version, instruction_bytes, instruction_digest, tool_profile_version
) VALUES (
  'restricted-research-stub/1',
  'fixture_only',
  'processing/3',
  convert_to('Deterministic restricted research protocol stub only. Read exact staged evidence through the bounded semantic broker. Fetch only exact server-admitted source URLs and use only configured semantic inventory reads. Emit source-bound proposals or application questions. Do not invoke actual models, native providers, shell, filesystem, browser or raw MCP tools. Do not access credentials, select human values, approve or mutate inventory, or resume native permission handles.', 'UTF8'),
  decode('f47aa3bd93d9033127a29727e511164eb77bc7b6ae5b5f7860e2fa4ea44fc4d0', 'hex'),
  'restricted-research-tools/1'
);

ALTER TABLE command ADD CONSTRAINT research_command_scope_unique
  UNIQUE(id,actor_id,target_id,target_context_id);
ALTER TABLE processing_attempt ADD CONSTRAINT research_attempt_command_unique
  UNIQUE(batch_id,id,command_id);
CREATE TABLE research_receipt (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('web','inventory')),
  source_url text CHECK(source_url IS NULL OR length(source_url) BETWEEN 1 AND 2048),
  media_type text NOT NULL CHECK(media_type IN ('text/html','text/plain','application/pdf','application/json')),
  byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
  body_bytes bytea NOT NULL CHECK(octet_length(body_bytes)=byte_size),
  body_digest bytea NOT NULL CHECK(octet_length(body_digest)=32),
  descriptor_bytes bytea NOT NULL CHECK(octet_length(descriptor_bytes) BETWEEN 1 AND 16384),
  descriptor_digest bytea NOT NULL CHECK(octet_length(descriptor_digest)=32),
  CHECK((kind='web' AND source_url IS NOT NULL) OR (kind='inventory' AND source_url IS NULL)),
  UNIQUE(attempt_id,request_id),
  FOREIGN KEY(batch_id,attempt_id,command_id)
    REFERENCES processing_attempt(batch_id,id,command_id) ON DELETE RESTRICT,
  FOREIGN KEY(command_id,actor_id,target_id,target_context_id)
    REFERENCES command(id,actor_id,target_id,target_context_id) ON DELETE RESTRICT
);
CREATE TRIGGER research_receipt_immutable BEFORE UPDATE OR DELETE ON research_receipt
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
