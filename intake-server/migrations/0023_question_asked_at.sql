-- When each question was asked, so Needs you can list questions oldest first.
ALTER TABLE processing_question ADD COLUMN asked_at timestamptz(3);

-- A session question's outbox entry was written in the same transaction as the question.
UPDATE processing_question AS question
SET asked_at = outbox.created_at
FROM agent_session_outbox AS outbox
WHERE outbox.kind = 'question' AND outbox.payload->>'question_id' = question.id::text;

-- Older runner questions keep no time and stay null.
ALTER TABLE processing_question ALTER COLUMN asked_at SET DEFAULT now();
