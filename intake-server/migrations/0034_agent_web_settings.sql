-- Web research settings for VM tool sessions. Both start on, so a fresh setup and every saved
-- row read as on until the operator saves otherwise.
ALTER TABLE agent_settings
  ADD COLUMN web_public_pages boolean NOT NULL DEFAULT true,
  ADD COLUMN web_prefer_datasheets boolean NOT NULL DEFAULT true;
