-- A saved batch instruction reaches the batch's sessions as an operator inbox item.
DO $$
DECLARE name text;
BEGIN
  FOR name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'agent_session_inbox'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE agent_session_inbox DROP CONSTRAINT %I', name);
  END LOOP;
END;
$$;
ALTER TABLE agent_session_inbox
  ADD CONSTRAINT agent_session_inbox_kind_check
    CHECK (kind IN ('answer','chat','evidence','revision','instruction')),
  -- Operator items name their operator; system notices name none.
  ADD CONSTRAINT agent_session_inbox_actor_check
    CHECK ((kind IN ('answer','chat','instruction')) = (actor_id IS NOT NULL));
