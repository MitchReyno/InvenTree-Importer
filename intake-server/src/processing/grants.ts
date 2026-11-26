import type { Pool } from 'pg'
import { grantCaptureAgentWrites, grantCaptureInputLocks } from '#/capture/grants.ts'
import { grantProjection } from '#/operations/grants.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantResearch } from '#/research/grants.ts'

/** Provisioning only. A research coordinator cannot manufacture a human answer or input. */
export async function grantProcessing(pool: Pool, role: string, purpose: 'api' | 'runner' = 'api') {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  await grantResearch(pool, role, purpose)
  await pool.query(`GRANT SELECT ON schema_migration,agent_settings,agent_provider_settings,agent_session,
    agent_session_outbox,agent_session_inbox,agent_session_cursor,agent_session_ack,agent_slot,agent_session_failure,processing_proposal_stale,
    agent_batch_pause,processing_question_replacement,processing_question_figure,processing_figure_render,
    processing_stage_instructions,processing_input_page,processing_brief_view,agent_session_inbox_withdrawal,
    agent_session_inbox_release,agent_session_resume,processing_question_basis,processing_identity_basis,agent_model_catalog TO ${role};`)
  if (purpose === 'api') {
    // Operators queue inbox items and mark proposals stale by correction; agents write the outbox.
    await pool.query(
      `GRANT INSERT ON agent_settings,agent_provider_settings,agent_session,agent_session_inbox,processing_proposal_stale TO ${role};
      -- Ungrouping withdraws a group's pending instruction items from stage sessions.
      GRANT INSERT ON agent_session_inbox_withdrawal TO ${role};
      GRANT INSERT, DELETE ON agent_batch_pause TO ${role};
      GRANT UPDATE(revision,provider,authentication,model,session_concurrency,default_provider,
        stage_selections,new_batch_instructions,part_description_style,auto_tags_default,
        web_public_pages,web_prefer_datasheets,receipts_pruned_through) ON agent_settings TO ${role};
      GRANT UPDATE(enabled,authentication,default_model,default_effort) ON agent_provider_settings TO ${role};
      -- Save receipts: written with each save, pruned by later saves, never rewritten.
      GRANT SELECT, INSERT, DELETE ON agent_settings_save_receipt TO ${role};
      -- The model catalogue is the worker's; the API may only request a read.
      GRANT EXECUTE ON FUNCTION request_model_catalog_refresh(uuid,uuid,uuid,text,text,boolean) TO ${role};`,
    )
  } else {
    await pool.query(
      `GRANT UPDATE(started_at,finished_at,native_session_id,actual_model,sent_effort,progress,
        session_state,session_lineage_id,capability_sha256,turn_count,queued_since) ON agent_session TO ${role};
      GRANT INSERT ON agent_session_failure,agent_session_outbox,processing_proposal_stale TO ${role};
      -- Without actor_id the runner can write system notices only, never operator chat or answers.
      GRANT INSERT(id,session_lineage_id,seq,kind,payload,idempotency_key) ON agent_session_inbox TO ${role};
      GRANT INSERT, UPDATE(acked_seq,acked_at) ON agent_session_cursor TO ${role};
      -- Group instructions given to a session, and the state each wake left.
      GRANT INSERT ON agent_session_inbox_release TO ${role};
      GRANT INSERT, UPDATE(from_state), DELETE ON agent_session_resume TO ${role};
      -- Each cursor advance is logged, and an ask may close the question it replaces.
      GRANT INSERT ON agent_session_ack,processing_question_replacement TO ${role};
      -- A stage ask keeps the evidence and conflict it names, for the next ask to compare.
      GRANT INSERT ON processing_question_basis TO ${role};
      -- A stable identity keeps the lot as it saw it, for the claim and Review gate.
      GRANT INSERT ON processing_identity_basis TO ${role};
      -- An ask stores its figures and their render requests; the media consumer renders them.
      GRANT INSERT ON processing_question_figure,processing_figure_render TO ${role};
      -- A preview asked again is kept a day from then.
      GRANT UPDATE(requested_at) ON processing_figure_render TO ${role};
      GRANT INSERT, UPDATE, DELETE ON agent_slot TO ${role};
      -- A brief's current views, kept per attempt within a bound.
      GRANT INSERT, DELETE, UPDATE(read_at) ON processing_brief_view TO ${role};
      -- Each provider's model list as this worker reads it.
      GRANT INSERT, UPDATE ON agent_model_catalog TO ${role};`,
    )
  }
  await pool.query(`GRANT SELECT ON processing_profile,processing_input,processing_job,processing_attempt,
    processing_dependency,processing_lane,processing_message,processing_proposal,processing_question,processing_answer,processing_transition TO ${role};
    GRANT INSERT ON processing_lane,processing_message,processing_proposal,processing_question TO ${role};
    GRANT UPDATE(state,revision) ON processing_job TO ${role};
    GRANT UPDATE(state,last_sequence) ON processing_attempt TO ${role};
    GRANT UPDATE(attempt_id) ON processing_lane TO ${role};
    GRANT UPDATE(state,revision) ON processing_question TO ${role};`)
  if (purpose === 'api') {
    await grantMedia(pool, role, 'processing')
    await pool.query(`GRANT INSERT ON processing_input,processing_input_page,processing_job,processing_attempt,processing_dependency,processing_answer TO ${role};
      GRANT UPDATE(current_attempt_id) ON processing_job TO ${role};`)
  } else {
    await grantCaptureInputLocks(pool, role)
    await grantMedia(pool, role, 'processing-reader')
    // Reading the owning capture projection and publishing its stream grants no selection write.
    await pool.query(`GRANT SELECT ON operator,target,target_context,command,outbox,ui_stream,ui_event,
      capture_source,capture_batch,capture_subject,capture_part,capture_lot,capture_note,capture_observation,capture_selection,capture_revision,
      capture_evidence_observation,capture_lot_evidence_observation,capture_lot_retirement TO ${role};
      GRANT INSERT ON ui_event TO ${role}; GRANT UPDATE(head) ON ui_stream TO ${role};
      GRANT UPDATE(delivery_attempts,acked_at,conflict_code) ON outbox TO ${role};
      GRANT UPDATE(revision) ON capture_batch TO ${role};`)
    // PostgreSQL SELECT FOR UPDATE requires UPDATE privilege on at least one column.
    // An unchanged revision column is enough; human title/archive/selection remain denied.
  }
}

/**
 * The Examine lead session's own role: draft capture writes plus the session's Processing results.
 * It inherits nothing from the runner, which keeps its denial of capture and command writes.
 */
export async function grantAgentWriter(pool: Pool, role: string) {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  await grantProjection(pool, role)
  await grantCaptureAgentWrites(pool, role)
  await grantMedia(pool, role, 'processing')
  await pool.query(`GRANT SELECT ON schema_migration,command,agent_settings,agent_provider_settings,agent_session,agent_session_outbox,
      agent_session_inbox,agent_session_cursor,agent_session_ack,agent_slot,processing_proposal_stale,processing_profile,processing_input,
      processing_job,processing_attempt,processing_dependency,processing_lane,processing_message,processing_proposal,
      processing_question,processing_answer,processing_transition,agent_batch_pause,processing_question_replacement,
      processing_question_figure,processing_figure_render,processing_stage_instructions,processing_input_page,agent_session_inbox_withdrawal,
      agent_session_inbox_release,processing_question_basis,processing_identity_basis TO ${role};
    GRANT INSERT ON processing_proposal,processing_proposal_stale,processing_message,agent_session_outbox,
      processing_question,processing_question_figure,processing_figure_render,processing_identity_basis TO ${role};
    GRANT UPDATE(state,revision) ON processing_job TO ${role};
    GRANT UPDATE(state,last_sequence) ON processing_attempt TO ${role};
    GRANT UPDATE(state,revision) ON processing_question TO ${role};
    -- FOR UPDATE needs an UPDATE privilege; outbox appends lock the session row to keep their
    -- sequence gap-free. progress is a display hint only.
    GRANT UPDATE(progress) ON agent_session TO ${role};
    -- The Examine trigger creates the lead job and sends new-evidence notices; no actor_id, so
    -- it can never write operator chat or answers.
    GRANT INSERT ON processing_job,processing_attempt,processing_input,processing_input_page,command,outbox,agent_session,agent_session_inbox_withdrawal TO ${role};
    GRANT UPDATE(current_attempt_id) ON processing_job TO ${role};
    GRANT INSERT(id,session_lineage_id,seq,kind,payload,idempotency_key) ON agent_session_inbox TO ${role};`)
}
