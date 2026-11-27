-- Images proposals rendered for review, and the images an operator confirms for a lot.

-- Each crop an `images/1` proposal names, in the agent's order, with the recipe `/2` its view
-- render is keyed by. The render sweep keeps a view while a proposal or a question shows it.
CREATE TABLE processing_proposal_image (
  proposal_id uuid NOT NULL REFERENCES processing_proposal(id) ON DELETE RESTRICT,
  image_index smallint NOT NULL CHECK(image_index BETWEEN 1 AND 10),
  batch_id uuid NOT NULL,
  version_id uuid NOT NULL,
  page integer NOT NULL CHECK(page BETWEEN 1 AND 30),
  recipe_digest bytea NOT NULL CHECK(octet_length(recipe_digest)=32),
  PRIMARY KEY(proposal_id,image_index),
  FOREIGN KEY(batch_id,version_id) REFERENCES media_version(batch_id,id) ON DELETE RESTRICT
);
CREATE INDEX processing_proposal_image_recipe ON processing_proposal_image(recipe_digest);
CREATE INDEX processing_proposal_image_batch ON processing_proposal_image(batch_id);
CREATE TRIGGER processing_proposal_image_immutable BEFORE UPDATE OR DELETE ON processing_proposal_image
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- A lot's confirmed images: one Part image and an ordered set of stock images, each a derived
-- crop of a retained original. Rows are append-only; a lot's latest revision is its current set,
-- and a set with no items clears it.
CREATE TABLE media_image_selection (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'lot' CHECK(subject_kind='lot'),
  revision bigint NOT NULL CHECK(revision>0),
  actor_id uuid NOT NULL REFERENCES operator(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,subject_id,revision),
  UNIQUE(batch_id,id),
  FOREIGN KEY(batch_id,subject_id,subject_kind) REFERENCES capture_subject(batch_id,id,kind)
);
CREATE TABLE media_image_selection_item (
  selection_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('part_image','stock_image')),
  -- The Part image is position 0; stock images are 1 to 8, in the operator's order.
  position smallint NOT NULL CHECK(position BETWEEN 0 AND 8),
  -- The derived crop's derivation; its version, once decoded, has the same id.
  derivation_id uuid NOT NULL,
  PRIMARY KEY(selection_id,position),
  CHECK((role='part_image')=(position=0)),
  FOREIGN KEY(batch_id,selection_id) REFERENCES media_image_selection(batch_id,id),
  FOREIGN KEY(batch_id,derivation_id) REFERENCES media_derivation(batch_id,id)
);
CREATE INDEX media_image_selection_item_derivation ON media_image_selection_item(derivation_id);
CREATE TRIGGER media_image_selection_immutable BEFORE UPDATE OR DELETE ON media_image_selection
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
CREATE TRIGGER media_image_selection_item_immutable BEFORE UPDATE OR DELETE ON media_image_selection_item
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
