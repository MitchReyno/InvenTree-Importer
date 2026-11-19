-- Claude and Codex are set up separately, and each step may name its own provider and model.
-- provider, authentication and model stay on agent_settings, mirroring the default provider, so
-- the code before this change can still roll back onto valid values.
CREATE TABLE agent_provider_settings (
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN ('codex','claude')),
  enabled boolean NOT NULL,
  authentication text NOT NULL CHECK(authentication IN ('api_key','subscription')),
  -- A provider that is off may keep an empty model; one that is on needs a valid model ID.
  default_model text NOT NULL CHECK(length(default_model) <= 128),
  PRIMARY KEY(actor_id,target_id,target_context_id,provider),
  FOREIGN KEY(actor_id,target_id,target_context_id)
    REFERENCES agent_settings(actor_id,target_id,target_context_id) ON DELETE RESTRICT,
  CHECK(NOT enabled OR default_model ~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$')
);

-- default_provider is null exactly when no provider is on.
ALTER TABLE agent_settings
  ADD COLUMN default_provider text CHECK(default_provider IN ('codex','claude')),
  ADD COLUMN stage_selections jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(stage_selections)='object'),
  ADD COLUMN new_batch_instructions text NOT NULL DEFAULT ''
    CHECK(length(new_batch_instructions) <= 8192),
  ADD COLUMN part_description_style text NOT NULL DEFAULT ''
    CHECK(length(part_description_style) <= 500),
  ADD COLUMN auto_tags_default boolean NOT NULL DEFAULT false;

-- Each saved selection becomes its provider, on; the other provider starts off with subscription
-- sign-in and the first model of its suggestion list. Revisions are unchanged.
UPDATE agent_settings SET default_provider = provider;
INSERT INTO agent_provider_settings
  (actor_id,target_id,target_context_id,provider,enabled,authentication,default_model)
SELECT actor_id,target_id,target_context_id,provider,true,authentication,model FROM agent_settings
UNION ALL
SELECT actor_id,target_id,target_context_id,
  CASE provider WHEN 'claude' THEN 'codex' ELSE 'claude' END,
  false,
  'subscription',
  CASE provider WHEN 'claude' THEN 'gpt-6.1-sol' ELSE 'sonnet' END
FROM agent_settings;

-- App-level defaults copied into each new batch at creation; batches never follow later changes.
CREATE TABLE batch_defaults (
  actor_id uuid NOT NULL REFERENCES operator(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL REFERENCES target(id) ON DELETE RESTRICT,
  target_context_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  location_pk bigint CHECK(location_pk>0),
  supplier_pk bigint CHECK(supplier_pk>0),
  PRIMARY KEY(actor_id,target_id,target_context_id),
  FOREIGN KEY(target_id,target_context_id) REFERENCES target_context(target_id,id) ON DELETE RESTRICT
);

-- Defaults a new batch could not copy, such as a location that no longer exists. Never a note:
-- Processing treats capture notes as human evidence.
ALTER TABLE capture_batch ADD COLUMN creation_notices jsonb
  CHECK(creation_notices IS NULL OR jsonb_typeof(creation_notices)='array');
