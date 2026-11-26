-- Each agent step's own instructions, sealed into the inputs of that step queued after a save.
-- Keys are examine, research and images, each 1 to 1,000 characters, checked on save; a step
-- without instructions has no key.
ALTER TABLE agent_settings
  ADD COLUMN stage_instructions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(stage_instructions)='object');
