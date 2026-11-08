ALTER TABLE processing_profile
  DROP CONSTRAINT processing_profile_version_pair_check,
  ADD CONSTRAINT processing_profile_version_pair_check CHECK (
    (id='synthetic-research/1' AND handler_version='processing/1' AND tool_profile_version='restricted-no-tools/1' AND qualification='fixture_only')
    OR (id='synthetic-research/2' AND handler_version='processing/2' AND tool_profile_version='restricted-no-tools/1' AND qualification='fixture_only')
    OR (id='restricted-research-stub/1' AND handler_version='processing/3' AND tool_profile_version='restricted-research-tools/1' AND qualification='fixture_only')
    OR (id='native-agent/1' AND handler_version='processing/4' AND tool_profile_version='native-no-tools/1' AND qualification='native_unverified')
    OR (id IN ('native-agent/2','shared-vm-agent/1') AND handler_version='processing/5' AND tool_profile_version='native-session-tools/1' AND qualification='native_unverified')
    OR (id='synthetic-session/1' AND handler_version='processing/5' AND tool_profile_version='native-session-tools/1' AND qualification='fixture_only')
  );
INSERT INTO processing_profile SELECT 'shared-vm-agent/1', qualification, handler_version,
  instruction_bytes, instruction_digest, tool_profile_version FROM processing_profile WHERE id='native-agent/2';
