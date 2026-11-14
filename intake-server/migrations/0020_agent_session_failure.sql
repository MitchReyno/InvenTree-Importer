CREATE TABLE agent_session_failure (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES agent_session(attempt_id),
  turn_count bigint NOT NULL CHECK(turn_count >= 0),
  diagnostic jsonb NOT NULL CHECK(jsonb_typeof(diagnostic) = 'object' AND octet_length(diagnostic::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, turn_count)
);
