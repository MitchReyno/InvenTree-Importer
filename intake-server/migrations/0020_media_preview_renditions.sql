-- Display-only WebP renditions of a ready page; the page preview stays the full-resolution PNG.
CREATE TABLE media_preview_rendition (
  preview_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  size text NOT NULL CHECK(size IN ('thumb','card','view')),
  width integer NOT NULL CHECK(width BETWEEN 1 AND 2048),
  height integer NOT NULL CHECK(height BETWEEN 1 AND 2048),
  blob_digest bytea NOT NULL REFERENCES media_blob(digest),
  PRIMARY KEY(preview_id,size),
  FOREIGN KEY(batch_id,preview_id) REFERENCES media_preview(batch_id,id)
);
CREATE INDEX media_preview_rendition_blob ON media_preview_rendition(blob_digest);
CREATE TRIGGER media_preview_rendition_immutable BEFORE UPDATE OR DELETE ON media_preview_rendition
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
