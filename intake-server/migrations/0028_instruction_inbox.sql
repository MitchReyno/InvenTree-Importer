-- A saved batch instruction reaches the batch's sessions as a system relay of that instruction.
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
  -- Operator items name their operator; system notices, relayed instructions included, name none.
  ADD CONSTRAINT agent_session_inbox_actor_check
    CHECK ((kind IN ('answer','chat')) = (actor_id IS NOT NULL));

-- An instruction may hold 8,192 four-byte characters, more than another item's 32 KiB allows.
DO $$
DECLARE name text;
BEGIN
  FOR name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'agent_session_inbox'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%octet_length%'
  LOOP
    EXECUTE format('ALTER TABLE agent_session_inbox DROP CONSTRAINT %I', name);
  END LOOP;
END;
$$;
ALTER TABLE agent_session_inbox
  ADD CONSTRAINT agent_session_inbox_payload_check
    CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)
      <= CASE WHEN kind='instruction' THEN 65536 ELSE 32768 END);

-- Any role that starts a session relays the saved instructions, so each must match a saved one.
CREATE FUNCTION require_session_instruction_binding() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.kind='instruction' AND NOT EXISTS (
    SELECT 1 FROM public.capture_instruction i
      JOIN public.processing_job j ON j.batch_id=i.batch_id
    WHERE j.id=NEW.session_lineage_id
      AND i.id::text=NEW.payload->>'instruction_id'
      AND i.text=NEW.payload->>'text'
      AND i.group_id::text IS NOT DISTINCT FROM NEW.payload->>'group_id'
  ) THEN
    RAISE EXCEPTION 'session_instruction_binding_invalid' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION require_session_instruction_binding() FROM PUBLIC;
CREATE TRIGGER agent_session_inbox_instruction BEFORE INSERT ON agent_session_inbox
  FOR EACH ROW EXECUTE FUNCTION require_session_instruction_binding();
