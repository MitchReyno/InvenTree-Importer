-- Each advance of a session's inbox cursor, as the interval (from_seq, to_seq] it acknowledged, so
-- an answer's read time survives later advances. Cursors acknowledged before this log existed get
-- one baseline row with no time.
CREATE TABLE agent_session_ack (
  session_lineage_id uuid NOT NULL REFERENCES agent_session_cursor(session_lineage_id) ON DELETE RESTRICT,
  from_seq bigint NOT NULL CHECK(from_seq>=0),
  to_seq bigint NOT NULL,
  acked_at timestamptz,
  PRIMARY KEY(session_lineage_id,to_seq),
  CHECK(to_seq>from_seq)
);
CREATE TRIGGER agent_session_ack_immutable BEFORE UPDATE OR DELETE ON agent_session_ack
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
INSERT INTO agent_session_ack(session_lineage_id,from_seq,to_seq,acked_at)
  SELECT session_lineage_id,0,acked_seq,NULL FROM agent_session_cursor WHERE acked_seq>0;

-- A later question of the same job that named an earlier, unanswered one as the one it replaces.
CREATE TABLE processing_question_replacement (
  job_id uuid NOT NULL,
  question_id uuid PRIMARY KEY,
  replaced_by uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(question_id<>replaced_by),
  FOREIGN KEY(job_id,question_id) REFERENCES processing_question(job_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(job_id,replaced_by) REFERENCES processing_question(job_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER processing_question_replacement_immutable BEFORE UPDATE OR DELETE ON processing_question_replacement
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
