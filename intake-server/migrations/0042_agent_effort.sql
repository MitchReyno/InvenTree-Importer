-- The effort sent with a provider's default model, and the effort a session dispatched. Both are
-- provider-defined levels checked for shape only; null is Default, which sends none. A step's own
-- effort lives in `agent_settings.stage_selections`, checked on save.
ALTER TABLE agent_provider_settings
  ADD COLUMN default_effort text CHECK (default_effort ~ '^[a-z][a-z0-9_-]{0,31}$');
-- Set once a turn has passed the sealed effort to the CLI; null when none was sent.
ALTER TABLE agent_session
  ADD COLUMN sent_effort text CHECK (sent_effort ~ '^[a-z][a-z0-9_-]{0,31}$');
