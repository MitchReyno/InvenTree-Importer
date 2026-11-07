-- Supervised creation of new locations and supplier companies under owned-fake-effects/2.
-- Earlier plan versions, their constraints and retained rows are unchanged.
ALTER TABLE executor_deployment DROP CONSTRAINT executor_deployment_capability_check;
ALTER TABLE executor_deployment ADD CONSTRAINT executor_deployment_capability_check CHECK(capability IN ('owned-fake-stock/1','owned-fake-media/1','owned-fake-effects/1','owned-fake-effects/2'));
ALTER TABLE executor_supported_operation DROP CONSTRAINT executor_supported_operation_kind_check;
ALTER TABLE executor_supported_operation ADD CONSTRAINT executor_supported_operation_kind_check CHECK(kind IN ('create_part','parameter','manufacturer','supplier','part_attachment','create_stock','create_location','create_company'));
-- One created record per source and reference draft; a later run reuses its confirmed output.
CREATE TABLE executor_record_identity (
  target_id uuid NOT NULL,
  original_key uuid NOT NULL,
  draft_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('location','company')),
  run_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  spec_digest bytea NOT NULL CHECK(octet_length(spec_digest)=32),
  PRIMARY KEY(target_id,original_key,draft_id),
  FOREIGN KEY(run_id,target_id,original_key) REFERENCES executor_run(id,target_id,original_key),
  FOREIGN KEY(run_id,operation_key) REFERENCES executor_supported_operation(run_id,operation_key)
);
CREATE TRIGGER executor_record_identity_immutable BEFORE UPDATE OR DELETE ON executor_record_identity
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
