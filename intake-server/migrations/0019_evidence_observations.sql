-- Evidence observations: items seen in a region of one evidence version, grouped into lots.
-- `capture_observation` is the unrelated record of an inventory read, hence the distinct name.
CREATE TABLE capture_evidence_observation (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES capture_batch(id),
  evidence_version_id uuid NOT NULL,
  page integer NOT NULL DEFAULT 1 CHECK(page BETWEEN 1 AND 10000),
  region jsonb NOT NULL CHECK(jsonb_typeof(region)='object' AND region->>'kind' IN ('pixels','lines')),
  readings jsonb NOT NULL CHECK(jsonb_typeof(readings)='object'),
  visible_count integer CHECK(visible_count BETWEEN 0 AND 1000000),
  -- A suggested row is the lead session's revision of an operator-edited observation.
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suggested')),
  supersedes_observation_id uuid,
  origin text NOT NULL CHECK(origin IN ('agent','operator')),
  agent_session_id uuid REFERENCES agent_session(attempt_id),
  operator_edited boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL CHECK(revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,id),
  FOREIGN KEY(batch_id,evidence_version_id) REFERENCES media_version(batch_id,id),
  FOREIGN KEY(batch_id,supersedes_observation_id) REFERENCES capture_evidence_observation(batch_id,id),
  CHECK((status='suggested') = (supersedes_observation_id IS NOT NULL)),
  CHECK((origin='agent') = (agent_session_id IS NOT NULL))
);
CREATE INDEX capture_evidence_observation_version ON capture_evidence_observation(batch_id,evidence_version_id);

-- Lot membership. An active observation belongs to at most one lot; suggestions await the operator.
CREATE TABLE capture_lot_evidence_observation (
  batch_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  evidence_observation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suggested')),
  agent_session_id uuid REFERENCES agent_session(attempt_id),
  revision bigint NOT NULL CHECK(revision > 0),
  PRIMARY KEY(lot_id,evidence_observation_id),
  FOREIGN KEY(batch_id,lot_id) REFERENCES capture_lot(batch_id,id),
  FOREIGN KEY(batch_id,evidence_observation_id) REFERENCES capture_evidence_observation(batch_id,id)
);
CREATE UNIQUE INDEX capture_lot_evidence_observation_active
  ON capture_lot_evidence_observation(evidence_observation_id) WHERE status='active';
CREATE INDEX capture_lot_evidence_observation_batch ON capture_lot_evidence_observation(batch_id,lot_id);

ALTER TABLE capture_lot
  ADD COLUMN origin text NOT NULL DEFAULT 'operator' CHECK(origin IN ('agent','operator')),
  ADD COLUMN agent_session_id uuid REFERENCES agent_session(attempt_id),
  ADD COLUMN operator_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN estimated_quantity text CHECK(estimated_quantity ~ '^(?=.*[1-9])(0|[1-9][0-9]{0,12})(\.[0-9]{0,5}[1-9])?$'),
  ADD COLUMN quantity_basis text CHECK(length(quantity_basis) BETWEEN 1 AND 512),
  ADD COLUMN observation_set_version bigint NOT NULL DEFAULT 0 CHECK(observation_set_version >= 0),
  -- Batch revision of the lot's last change, so a lot-forming call can tell what changed after it read.
  ADD COLUMN changed_revision bigint NOT NULL DEFAULT 1 CHECK(changed_revision > 0),
  ADD CONSTRAINT capture_lot_origin_session CHECK((origin='agent') = (agent_session_id IS NOT NULL)),
  ADD CONSTRAINT capture_lot_estimate_basis CHECK(estimated_quantity IS NULL OR quantity_basis IS NOT NULL);

-- Agent writes keep the operator actor and record the session that made them.
ALTER TABLE capture_revision ADD COLUMN agent_session_id uuid REFERENCES agent_session(attempt_id);
ALTER TABLE capture_subject ADD COLUMN agent_session_id uuid REFERENCES agent_session(attempt_id);

-- The shared identity trigger also guards capture_lot; its draft-state columns may change.
CREATE OR REPLACE FUNCTION capture_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[] := ARRAY['title','revision','archived','updated_at','label','part_subject_id',
  'operator_edited','estimated_quantity','quantity_basis','observation_set_version','changed_revision'];
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) THEN
    RAISE EXCEPTION 'immutable_capture_identity' USING ERRCODE='23000';
  END IF;
  RETURN NEW;
END;
$$;

-- Identity and authorship never change; only suggestions may be deleted.
CREATE FUNCTION capture_evidence_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[] := ARRAY['region','readings','visible_count','status','operator_edited','revision'];
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
CREATE TRIGGER capture_evidence_observation_guard BEFORE UPDATE OR DELETE ON capture_evidence_observation
  FOR EACH ROW EXECUTE FUNCTION capture_evidence_observation_guard();

CREATE FUNCTION capture_lot_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision'])
    OR (OLD.status='active' AND NEW.status<>'active')) THEN
    RAISE EXCEPTION 'immutable_lot_membership' USING ERRCODE='23000';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE TRIGGER capture_lot_membership_guard BEFORE UPDATE ON capture_lot_evidence_observation
  FOR EACH ROW EXECUTE FUNCTION capture_lot_membership_guard();

-- Agent writer roles are members of this cluster-wide marker, so the guards below can tell them apart.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='intake_agent_writer_marker') THEN
    CREATE ROLE intake_agent_writer_marker NOLOGIN;
  END IF;
END;
$$;

-- Inherited membership counts; superusers, which pg_has_role treats as members of every role,
-- are never agent principals.
CREATE FUNCTION is_agent_writer() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pg_has_role(current_user, 'intake_agent_writer_marker', 'MEMBER')
    AND NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
$$;

-- Agent principals never touch edited rows except through suggestions, and never set counted values.
CREATE FUNCTION capture_agent_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.is_agent_writer() THEN
    RETURN COALESCE(NEW,OLD);
  END IF;
  IF TG_TABLE_NAME='capture_lot' THEN
    IF TG_OP='INSERT' AND (NEW.origin<>'agent' OR NEW.operator_edited) THEN
      RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND (OLD.operator_edited OR OLD.origin<>'agent' OR NEW.operator_edited) THEN
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
CREATE TRIGGER capture_lot_agent_write BEFORE INSERT OR UPDATE ON capture_lot
  FOR EACH ROW EXECUTE FUNCTION capture_agent_write_guard();
CREATE TRIGGER capture_evidence_observation_agent_write BEFORE INSERT OR UPDATE ON capture_evidence_observation
  FOR EACH ROW EXECUTE FUNCTION capture_agent_write_guard();
CREATE TRIGGER capture_lot_membership_agent_write BEFORE INSERT OR UPDATE OR DELETE ON capture_lot_evidence_observation
  FOR EACH ROW EXECUTE FUNCTION capture_agent_write_guard();

-- Agent principals rename only the subjects they created and the operator has not edited, record
-- capture revisions attributed to a session under the batch's own actor, and queue only processing.
CREATE FUNCTION capture_agent_subject_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_agent_writer() AND NEW.label IS DISTINCT FROM OLD.label AND (
      OLD.agent_session_id IS NULL OR
      EXISTS (SELECT 1 FROM public.capture_lot l WHERE l.id=OLD.id AND (l.operator_edited OR l.origin<>'agent'))) THEN
    RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_subject_agent_write BEFORE UPDATE ON capture_subject
  FOR EACH ROW EXECUTE FUNCTION capture_agent_subject_guard();

CREATE FUNCTION capture_agent_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_agent_writer() AND (NEW.agent_session_id IS NULL OR NEW.actor_id IS DISTINCT FROM
      (SELECT b.actor_id FROM public.capture_batch b WHERE b.id=NEW.batch_id)) THEN
    RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_revision_agent_write BEFORE INSERT ON capture_revision
  FOR EACH ROW EXECUTE FUNCTION capture_agent_revision_guard();

CREATE FUNCTION agent_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_agent_writer() AND NEW.kind<>'process' THEN
    RAISE EXCEPTION 'agent_write_refused' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER command_agent_write BEFORE INSERT ON command
  FOR EACH ROW EXECUTE FUNCTION agent_command_guard();
