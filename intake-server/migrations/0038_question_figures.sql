-- Pictures on agent questions. A render is durable media work: the ask stores one request per
-- view (keyed by its recipe digest) or per marked preview (recipe and marks), and the render
-- consumer claims it under a lease, renders it in the decoder and stores the outputs as blobs.
CREATE TABLE processing_figure_render (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  version_id uuid NOT NULL,
  page integer NOT NULL CHECK(page BETWEEN 1 AND 30),
  purpose text NOT NULL CHECK(purpose IN ('view','preview')),
  recipe_bytes bytea NOT NULL,
  recipe_digest bytea NOT NULL CHECK(octet_length(recipe_digest)=32),
  marks_bytes bytea,
  marks_digest bytea CHECK(octet_length(marks_digest)=32),
  -- The session a preview was rendered for, which bounds its unsettled previews.
  session_lineage_id uuid,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','ready','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  lease_owner uuid,
  lease_expires_at timestamptz,
  view_digest bytea REFERENCES media_blob(digest),
  view_width integer CHECK(view_width>0),
  view_height integer CHECK(view_height>0),
  thumb_digest bytea REFERENCES media_blob(digest),
  preview_digest bytea REFERENCES media_blob(digest),
  preview_width integer CHECK(preview_width>0),
  preview_height integer CHECK(preview_height>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- When a preview was last asked for; it is kept a day from then.
  requested_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  FOREIGN KEY(batch_id,version_id) REFERENCES media_version(batch_id,id) ON DELETE RESTRICT,
  CHECK((purpose='view')=(marks_digest IS NULL AND session_lineage_id IS NULL)),
  CHECK((marks_bytes IS NULL)=(marks_digest IS NULL)),
  -- A view keeps the operator's picture and thumbnail; a preview only its marked picture.
  CHECK(state<>'ready' OR CASE purpose
    WHEN 'view' THEN view_digest IS NOT NULL AND thumb_digest IS NOT NULL AND preview_digest IS NULL
    ELSE preview_digest IS NOT NULL AND view_digest IS NULL AND thumb_digest IS NULL END),
  CHECK((state='queued')=(settled_at IS NULL))
);
CREATE UNIQUE INDEX processing_figure_render_view ON processing_figure_render(recipe_digest)
  WHERE purpose='view';
CREATE UNIQUE INDEX processing_figure_render_preview
  ON processing_figure_render(recipe_digest,marks_digest) WHERE purpose='preview';
CREATE INDEX processing_figure_render_queued ON processing_figure_render(created_at)
  WHERE state='queued';
CREATE INDEX processing_figure_render_version ON processing_figure_render(version_id);

-- Each stored question's figures, in the agent's order, with the view recipe each one shows.
CREATE TABLE processing_question_figure (
  question_id uuid NOT NULL REFERENCES processing_question(id) ON DELETE RESTRICT,
  figure_index smallint NOT NULL CHECK(figure_index BETWEEN 1 AND 5),
  batch_id uuid NOT NULL,
  version_id uuid NOT NULL,
  page integer NOT NULL CHECK(page BETWEEN 1 AND 30),
  recipe_digest bytea NOT NULL CHECK(octet_length(recipe_digest)=32),
  PRIMARY KEY(question_id,figure_index),
  FOREIGN KEY(batch_id,question_id) REFERENCES processing_question(batch_id,id) ON DELETE RESTRICT
);
CREATE INDEX processing_question_figure_recipe ON processing_question_figure(recipe_digest);
CREATE TRIGGER processing_question_figure_immutable BEFORE UPDATE OR DELETE ON processing_question_figure
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- Blobs a deleted render no longer references. The sweep collects each once it is a day old,
-- the blob store's minimum collection age, unless something else references it by then.
CREATE TABLE processing_figure_blob_release (
  digest bytea PRIMARY KEY CHECK(octet_length(digest)=32),
  released_at timestamptz NOT NULL DEFAULT now()
);
