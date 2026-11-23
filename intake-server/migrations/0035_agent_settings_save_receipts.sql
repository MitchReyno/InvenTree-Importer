-- Each agent settings save writes a receipt in its own transaction, so a resend of a save whose
-- answer was lost is recognised instead of applied twice. Receipts are pruned per scope; the
-- watermark is the highest revision pruned, below which a resend with no receipt is unknown.
CREATE TABLE agent_settings_save_receipt (
  save_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  target_id uuid NOT NULL,
  target_context_id uuid NOT NULL,
  payload_sha256 bytea NOT NULL CHECK(octet_length(payload_sha256) = 32),
  base_revision bigint NOT NULL CHECK(base_revision >= 0),
  revision bigint NOT NULL CHECK(revision = base_revision + 1),
  saved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(actor_id,target_id,target_context_id)
    REFERENCES agent_settings(actor_id,target_id,target_context_id) ON DELETE RESTRICT
);
CREATE INDEX agent_settings_save_receipt_scope
  ON agent_settings_save_receipt(actor_id,target_id,target_context_id,revision);

ALTER TABLE agent_settings
  ADD COLUMN receipts_pruned_through bigint NOT NULL DEFAULT 0
    CHECK(receipts_pruned_through >= 0 AND receipts_pruned_through <= revision);
