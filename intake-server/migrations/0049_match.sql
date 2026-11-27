-- Match: the app's search of InvenTree and other batches for each `/7` lot, its questions and the
-- operator's decisions. Earlier pipelines write none of these.

-- A lot's current Match state. `search_generation` advances when a search is requested and
-- `settled_generation` when one settles, so only the latest request's result counts; the outcome
-- revision advances only when the outcome or a question changes.
CREATE TABLE processing_match (
  lot_id uuid PRIMARY KEY REFERENCES capture_lot(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES capture_batch(id) ON DELETE RESTRICT,
  search_generation bigint NOT NULL CHECK (search_generation >= 1),
  settled_generation bigint NOT NULL DEFAULT 0 CHECK (settled_generation BETWEEN 0 AND search_generation),
  outcome_revision bigint NOT NULL DEFAULT 0 CHECK (outcome_revision >= 0),
  state text NOT NULL CHECK (state IN ('searching','unavailable','clear','question','decided','held')),
  waits text[] NOT NULL DEFAULT '{}' CHECK (waits <@ ARRAY['research','images']::text[]),
  -- The identity the latest search was requested for, as canonical JSON.
  identity_bytes bytea NOT NULL,
  -- The lot's Capture binding (processing_match_binding) when its latest search was requested
  -- or its decision bound it: Match state is current only while Capture still matches it.
  binding jsonb NOT NULL,
  question_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processing_match_batch ON processing_match(batch_id);

-- What Match's state and a /7 stage attempt depend on in Capture: the lot's Part subject, the
-- InvenTree Part it selects, and, for a lot the operator added without evidence, a digest of the
-- identifiers its draft confirms (name, MPN and maker, SKU and supplier). Examine's lots are
-- identified by their pinned proposal instead.
CREATE FUNCTION processing_match_binding(lot uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'part_subject_id', l.part_subject_id,
    'part_pk', CASE WHEN c.value->>'mode' = 'set' THEN c.value->'value'->>'pk' END,
    'draft', CASE
      WHEN l.origin <> 'agent' AND c.value->>'mode' = 'create'
        AND NOT EXISTS (SELECT 1 FROM public.capture_lot_evidence_observation e
                        WHERE e.lot_id = l.id AND e.status = 'active')
      THEN encode(sha256(convert_to(jsonb_build_object(
        'name', c.value->'spec'->>'name',
        'mpn', c.value->'spec'->'manufacturer'->>'mpn',
        'manufacturer_pk', c.value->'spec'->'manufacturer'->'company'->>'pk',
        'sku', c.value->'spec'->'supplier'->>'sku',
        'supplier_pk', c.value->'spec'->'supplier'->'company'->>'pk')::text, 'UTF8')), 'hex')
    END)
  FROM public.capture_lot l
  LEFT JOIN LATERAL (
    SELECT s.value FROM public.capture_selection s
    WHERE s.subject_id = l.part_subject_id AND s.field = 'choice'
    ORDER BY s.version DESC LIMIT 1
  ) c ON true
  WHERE l.id = lot
$$;
REVOKE ALL ON FUNCTION processing_match_binding(uuid) FROM PUBLIC;

-- Each search request, with what it searched for and, once settled, what it found. A result
-- settles only while its generation is the lot's latest; an older one is discarded.
CREATE TABLE processing_match_search (
  lot_id uuid NOT NULL REFERENCES processing_match(lot_id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK (generation >= 1),
  batch_id uuid NOT NULL,
  request_bytes bytea NOT NULL,
  request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
  requested_at timestamptz NOT NULL DEFAULT now(),
  settlement text CHECK (settlement IN ('settled','unavailable','discarded')),
  result_bytes bytea,
  result_digest bytea CHECK (result_digest IS NULL OR octet_length(result_digest) = 32),
  settled_at timestamptz,
  -- A request whose search failed waits before it is tried again, so it can't hold up the rest.
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_after timestamptz,
  PRIMARY KEY (lot_id, generation),
  CHECK ((settlement IS NULL) = (settled_at IS NULL)),
  CHECK ((result_bytes IS NULL) = (result_digest IS NULL))
);
CREATE INDEX processing_match_search_pending ON processing_match_search(retry_after, requested_at)
  WHERE settlement IS NULL;

-- Each outcome a lot had: a clear verdict or a decision, with the modes it set and, for a
-- decision, the candidates it covered. Never rewritten.
CREATE TABLE processing_match_outcome (
  lot_id uuid NOT NULL REFERENCES processing_match(lot_id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision >= 1),
  generation bigint NOT NULL,
  outcome_bytes bytea NOT NULL,
  outcome_digest bytea NOT NULL CHECK (octet_length(outcome_digest) = 32),
  target_part_pk text CHECK (target_part_pk IS NULL OR target_part_pk ~ '^[1-9][0-9]{0,18}$'),
  covered_bytes bytea NOT NULL,
  question_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lot_id, revision)
);
CREATE TRIGGER processing_match_outcome_immutable BEFORE UPDATE OR DELETE ON processing_match_outcome
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();

-- App-owned questions, pinned to the search they were asked from and its outcome revision.
CREATE TABLE processing_match_question (
  id uuid PRIMARY KEY,
  lot_id uuid NOT NULL REFERENCES processing_match(lot_id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 1),
  outcome_revision bigint NOT NULL CHECK (outcome_revision >= 1),
  kind text NOT NULL CHECK (kind IN ('candidates','contribution','unresolved','target_lost')),
  question_bytes bytea NOT NULL,
  question_digest bytea NOT NULL CHECK (octet_length(question_digest) = 32),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','superseded')),
  asked_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK ((state = 'open') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX processing_match_question_open ON processing_match_question(lot_id)
  WHERE state = 'open';
CREATE INDEX processing_match_question_batch ON processing_match_question(batch_id, asked_at);

-- The operator's answer to a match question, as sent.
CREATE TABLE processing_match_answer (
  question_id uuid PRIMARY KEY REFERENCES processing_match_question(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES operator(id),
  answer_bytes bytea NOT NULL,
  answer_digest bytea NOT NULL CHECK (octet_length(answer_digest) = 32),
  answered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER processing_match_answer_immutable BEFORE UPDATE OR DELETE ON processing_match_answer
  FOR EACH ROW EXECUTE FUNCTION reject_authority_change();
