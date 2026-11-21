-- The operator marks an observation as the same physical item as another of its lot, such as one bag
-- photographed twice; the lot then counts that item once. Clearing the mark counts both again.
ALTER TABLE capture_evidence_observation
  ADD COLUMN same_item_as uuid,
  ADD CONSTRAINT capture_evidence_observation_same_item_not_self CHECK (same_item_as <> id),
  ADD CONSTRAINT capture_evidence_observation_same_item_fk
    FOREIGN KEY (batch_id, same_item_as) REFERENCES capture_evidence_observation(batch_id, id);

-- The mark is draft state the operator may change, like the region and readings.
CREATE OR REPLACE FUNCTION capture_evidence_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[] := ARRAY['region','readings','visible_count','status','operator_edited','revision',
  'same_item_as'];
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status <> 'suggested' THEN
      RAISE EXCEPTION 'evidence_observation_delete_refused' USING ERRCODE='23000';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable)
    OR (OLD.status='active' AND NEW.status<>'active') OR (OLD.operator_edited AND NOT NEW.operator_edited) THEN
    RAISE EXCEPTION 'immutable_evidence_observation' USING ERRCODE='23000';
  END IF;
  RETURN NEW;
END;
$$;

-- The lead session has no grant on the mark; it may not create an observation already marked either.
CREATE OR REPLACE FUNCTION capture_agent_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_agent_writer() THEN
    RETURN COALESCE(NEW,OLD);
  END IF;
  IF TG_TABLE_NAME='capture_lot' THEN
    IF TG_OP='INSERT' AND (NEW.origin<>'agent' OR NEW.operator_edited OR NEW.reexamine
        OR NEW.excluded_reason IS NOT NULL) THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND NEW.reexamine AND NOT OLD.reexamine THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND (OLD.operator_edited OR OLD.origin<>'agent' OR NEW.operator_edited)
      AND NOT (OLD.reexamine AND NOT NEW.reexamine
        AND (to_jsonb(NEW)-'reexamine') = (to_jsonb(OLD)-'reexamine')) THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME='capture_evidence_observation' THEN
    IF TG_OP='INSERT' AND (NEW.origin<>'agent' OR NEW.operator_edited OR NEW.same_item_as IS NOT NULL) THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND (OLD.operator_edited OR OLD.origin<>'agent' OR NEW.operator_edited OR NEW.status<>OLD.status) THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME='capture_lot_evidence_observation' THEN
    IF (EXISTS (SELECT 1 FROM public.capture_lot l WHERE l.id=COALESCE(NEW.lot_id,OLD.lot_id)
          AND (l.operator_edited OR l.origin<>'agent'))
        OR EXISTS (SELECT 1 FROM public.capture_evidence_observation o
          WHERE o.id=COALESCE(NEW.evidence_observation_id,OLD.evidence_observation_id)
            AND (o.operator_edited OR o.origin<>'agent')))
      AND (TG_OP<>'INSERT' OR NEW.status<>'suggested') THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
