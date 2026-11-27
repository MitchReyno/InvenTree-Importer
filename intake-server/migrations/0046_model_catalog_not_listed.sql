-- `not_listed`: the provider answered, but lists no models for this sign-in, as the pinned Claude
-- CLI does for a setup token. The API then serves the built-in list with that reason.
ALTER TABLE agent_model_catalog DROP CONSTRAINT agent_model_catalog_failure_check;
ALTER TABLE agent_model_catalog ADD CONSTRAINT agent_model_catalog_failure_check
  CHECK (failure IN ('timeout','guest_outdated','vm_unreachable','signed_out','malformed','unavailable','not_listed'));
