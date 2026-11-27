-- Per-preview attempts to render renditions for pages decoded before they existed.
CREATE TABLE media_rendition_backfill (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  preview_id uuid NOT NULL,
  attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),
  outcome text NOT NULL CHECK(outcome IN ('claimed','completed','skipped_mismatch','interrupted')),
  owner_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  retry_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(preview_id,attempt),
  FOREIGN KEY(batch_id,preview_id) REFERENCES media_preview(batch_id,id)
);
-- One live claim per preview, so concurrent workers never share one.
CREATE UNIQUE INDEX media_rendition_backfill_one_claim ON media_rendition_backfill(preview_id)
  WHERE outcome='claimed';

-- A claimed attempt may settle once; nothing else changes and nothing is deleted.
CREATE FUNCTION media_rendition_backfill_settle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.outcome <> 'claimed' OR NEW.outcome = 'claimed'
     OR (NEW.id, NEW.batch_id, NEW.preview_id, NEW.attempt, NEW.owner_id, NEW.claimed_at, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.batch_id, OLD.preview_id, OLD.attempt, OLD.owner_id, OLD.claimed_at, OLD.created_at) THEN
    RAISE EXCEPTION 'media_rendition_backfill_settled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_rendition_backfill_settle BEFORE UPDATE OR DELETE ON media_rendition_backfill
  FOR EACH ROW EXECUTE FUNCTION media_rendition_backfill_settle();
