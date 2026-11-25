-- A decode the dispatcher answered busy for its whole wait. Nothing ran, so the command keeps its
-- claim and gets no result, and a later worker run takes it again by deleting this row. A claim
-- with neither a result nor a deferral is still an attempt that needs inspection.
CREATE TABLE media_decode_deferral (
  command_id uuid PRIMARY KEY REFERENCES media_decode_claim(command_id),
  deferred_at timestamptz NOT NULL DEFAULT now()
);
