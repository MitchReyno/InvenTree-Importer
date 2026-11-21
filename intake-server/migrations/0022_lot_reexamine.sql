-- A lot whose reading the operator corrected, waiting for the lead session to look again.
ALTER TABLE capture_lot ADD COLUMN reexamine boolean NOT NULL DEFAULT false;

-- The re-examination mark is draft state, like operator_edited.
CREATE OR REPLACE FUNCTION capture_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[] := ARRAY['title','revision','archived','updated_at','label','part_subject_id',
  'operator_edited','reexamine','estimated_quantity','quantity_basis','observation_set_version',
  'changed_revision'];
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) THEN
    RAISE EXCEPTION 'immutable_capture_identity' USING ERRCODE='23000';
  END IF;
  RETURN NEW;
END;
$$;

-- The lead session may only clear a lot's mark, even on an edited lot, and never set one.
CREATE OR REPLACE FUNCTION capture_agent_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_agent_writer() THEN
    RETURN COALESCE(NEW,OLD);
  END IF;
  IF TG_TABLE_NAME='capture_lot' THEN
    IF TG_OP='INSERT' AND (NEW.origin<>'agent' OR NEW.operator_edited OR NEW.reexamine) THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND NEW.reexamine AND NOT OLD.reexamine THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND (OLD.operator_edited OR OLD.origin<>'agent' OR NEW.operator_edited)
      AND NOT (OLD.reexamine AND NOT NEW.reexamine
        AND (to_jsonb(NEW)-'reexamine') = (to_jsonb(OLD)-'reexamine')) THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME='capture_evidence_observation' THEN
    IF TG_OP='INSERT' AND (NEW.origin<>'agent' OR NEW.operator_edited) THEN
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
