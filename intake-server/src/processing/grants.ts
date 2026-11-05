import type { Pool } from 'pg'
import { grantCaptureInputLocks } from '../capture/grants.ts'
import { grantMedia } from '../media/grants.ts'
import { grantResearch } from '../research/grants.ts'

/** Provisioning only. A research coordinator cannot manufacture a human answer or input. */
export async function grantProcessing(pool: Pool, role: string, purpose: 'api' | 'runner' = 'api') {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  await grantResearch(pool, role, purpose)
  await pool.query(`GRANT SELECT ON schema_migration,agent_settings,agent_session,
    agent_session_outbox,agent_session_inbox,agent_session_cursor,agent_slot,processing_proposal_stale TO ${role};`)
  if (purpose === 'api') {
    // Operators queue inbox items and mark proposals stale by correction; agents write the outbox.
    await pool.query(
      `GRANT INSERT ON agent_settings,agent_session,agent_session_inbox,processing_proposal_stale TO ${role};
      GRANT UPDATE(revision,provider,authentication,model,session_concurrency) ON agent_settings TO ${role};`,
    )
  } else {
    await pool.query(
      `GRANT UPDATE(started_at,finished_at,native_session_id,actual_model,progress,
        session_state,session_lineage_id,capability_sha256,turn_count) ON agent_session TO ${role};
      GRANT INSERT ON agent_session_outbox,processing_proposal_stale TO ${role};
      -- Without actor_id the runner can write system notices only, never operator chat or answers.
      GRANT INSERT(id,session_lineage_id,seq,kind,payload,idempotency_key) ON agent_session_inbox TO ${role};
      GRANT INSERT, UPDATE(acked_seq,acked_at) ON agent_session_cursor TO ${role};
      GRANT INSERT, UPDATE, DELETE ON agent_slot TO ${role};`,
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
    await pool.query(`GRANT INSERT ON processing_input,processing_job,processing_attempt,processing_dependency,processing_answer TO ${role};
      GRANT UPDATE(current_attempt_id) ON processing_job TO ${role};`)
  } else {
    await grantCaptureInputLocks(pool, role)
    await grantMedia(pool, role, 'processing-reader')
    // Reading the owning capture projection and publishing its stream grants no selection write.
    await pool.query(`GRANT SELECT ON operator,target,target_context,command,outbox,ui_stream,ui_event,
      capture_source,capture_batch,capture_subject,capture_part,capture_lot,capture_note,capture_observation,capture_selection,capture_revision TO ${role};
      GRANT INSERT ON ui_event TO ${role}; GRANT UPDATE(head) ON ui_stream TO ${role};
      GRANT UPDATE(delivery_attempts,acked_at,conflict_code) ON outbox TO ${role};
      GRANT UPDATE(revision) ON capture_batch TO ${role};`)
    // PostgreSQL SELECT FOR UPDATE requires UPDATE privilege on at least one column.
    // An unchanged revision column is enough; human title/archive/selection remain denied.
  }
}
