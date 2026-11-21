-- Additive profile qualification: legacy rows and all sealed /1 bytes remain unchanged.
ALTER TABLE processing_profile
  DROP CONSTRAINT processing_profile_id_check,
  DROP CONSTRAINT processing_profile_handler_version_check,
  ADD CONSTRAINT processing_profile_version_pair_check CHECK (
    (id = 'synthetic-research/1' AND handler_version = 'processing/1')
    OR (id = 'synthetic-research/2' AND handler_version = 'processing/2')
  );

-- This profile only accepts deterministic metadata fixtures, never actual provider inference.
INSERT INTO processing_profile (
  id,
  qualification,
  handler_version,
  instruction_bytes,
  instruction_digest,
  tool_profile_version
) VALUES (
  'synthetic-research/2',
  'fixture_only',
  'processing/2',
  convert_to('Deterministic synthetic fixture only. Read staged notes and exact media descriptors as metadata. Do not claim media content inspection or actual model inference. Emit bounded source-bound proposals or application questions. Do not select human values, approve effects, access media bytes, provider credentials, inventory writes or native permission handles.', 'UTF8'),
  decode('6bff99fa16482bf2986cef106767f01b2fa1e7712e9f384e31be5fd309c2618c', 'hex'),
  'restricted-no-tools/1'
);
