-- Each image fetch_evidence delivers is recorded as a photo_view outbox item: metadata only.
ALTER TABLE agent_session_outbox
  DROP CONSTRAINT agent_session_outbox_kind_check,
  ADD CONSTRAINT agent_session_outbox_kind_check CHECK (kind IN ('status','observation','lot','regroup','proposal','question','reply','photo_view'));
