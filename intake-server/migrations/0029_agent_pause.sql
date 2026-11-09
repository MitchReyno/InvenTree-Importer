-- A batch whose agent sessions are paused: none starts new work until resumed. Nothing is
-- cancelled; queued sessions, answers and messages wait as they are.
CREATE TABLE agent_batch_pause (
  batch_id uuid PRIMARY KEY REFERENCES capture_batch(id),
  actor_id uuid NOT NULL REFERENCES operator(id),
  paused_at timestamptz NOT NULL DEFAULT now()
);
