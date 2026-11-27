-- Admission timeouts in a row that put a session back in the queue; the runner fails the session
-- once its retries are spent and resets the count when a turn settles any other way.
ALTER TABLE agent_session
  ADD COLUMN startup_timeouts integer NOT NULL DEFAULT 0 CHECK (startup_timeouts >= 0);
