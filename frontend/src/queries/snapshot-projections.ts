import type {
  BatchRecordsDto,
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'

/**
 * Stands in for an attempt or session message ID, which belongs to a session. A projection keeps
 * the contract's shape, and nothing shown from a snapshot can send a command, so the page never
 * needs the real one.
 */
export const WITHHELD_ID = '00000000-0000-4000-8000-000000000000'

type ProcessingJob = ProcessingSnapshotDto['jobs'][number]

/** A job as Processing shows it, without its attempt and message identifiers. */
function displayJob(job: ProcessingJob): ProcessingJob {
  return {
    ...job,
    attempt_id: WITHHELD_ID,
    proposals: job.proposals.map((proposal) => ({
      ...proposal,
      message_id: WITHHELD_ID,
      // The store validates the whole projection against the contract before it is written.
      value: withoutInboxItems(proposal.value) as typeof proposal.value,
    })),
    questions: job.questions.map((question) => ({ ...question, attempt_id: WITHHELD_ID })),
  }
}

/**
 * A proposal's sources without the session inbox messages it relied on. A source list left empty
 * fails validation, so that snapshot is not stored rather than stored with the message IDs.
 */
function withoutInboxItems(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => !isInboxItem(item)).map(withoutInboxItems)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutInboxItems(item)]),
    )
  }
  return value
}

function isInboxItem(value: unknown) {
  return typeof value === 'object' && value !== null && 'inbox_item_id' in value
}

/** The read each snapshot kind stores. */
export interface SnapshotData {
  processing: ProcessingSnapshotDto
  'review-workspace': ManualWorkspaceDto
  batch: CaptureSnapshotDto
  records: BatchRecordsDto
}

export type SnapshotKind = keyof SnapshotData

interface SnapshotProjection<K extends SnapshotKind> {
  /** The contract the stored projection is validated against. */
  schema: 'ProcessingSnapshot' | 'ManualWorkspace' | 'CaptureSnapshot' | 'BatchRecords'
  project: (read: SnapshotData[K]) => SnapshotData[K]
}

/**
 * The reads a reload may show at once, each through a projection of what its page renders. Each
 * projection is still a valid instance of its contract, so the contracts' validators check it on
 * write and on read. Nothing else is ever stored: not bootstrap or its CSRF token, credentials,
 * sign-in payloads, the Agents list, session identifiers, media, drafts or commands.
 */
export const SNAPSHOT_KINDS: { [K in SnapshotKind]: SnapshotProjection<K> } = {
  processing: {
    schema: 'ProcessingSnapshot',
    project: (read: ProcessingSnapshotDto): ProcessingSnapshotDto => ({
      runner_status: read.runner_status,
      batch_id: read.batch_id,
      capture_revision: read.capture_revision,
      jobs: read.jobs.map(displayJob),
      cursor: read.cursor,
      ...(read.paused ? { paused: read.paused } : {}),
    }),
  },
  // Review's own page: its lots' review state. Changes' preparations and runs stay out.
  'review-workspace': {
    schema: 'ManualWorkspace',
    project: (read: ManualWorkspaceDto): ManualWorkspaceDto => ({
      batch_id: read.batch_id,
      revision: read.revision,
      supported: read.supported,
      capability: read.capability,
      lots: read.lots,
      runs: [],
      preparations: [],
      preparations_truncated: false,
      cursor: read.cursor,
    }),
  },
  // The batch header and the lots and Parts the tabs name. Capture's settings, reference drafts,
  // context and the lots' agent session identifiers stay out.
  batch: {
    schema: 'CaptureSnapshot',
    project: (read: CaptureSnapshotDto): CaptureSnapshotDto => ({
      id: read.id,
      source_id: read.source_id,
      title: read.title,
      revision: read.revision,
      archived: read.archived,
      updated_at: read.updated_at,
      actor_id: read.actor_id,
      target_context_id: read.target_context_id,
      defaults: read.defaults,
      parts: read.parts,
      ...(read.group_locations ? { group_locations: read.group_locations } : {}),
      lots: read.lots.map(({ agent_session_id: _session, ...lot }) => lot),
      ...(read.evidence_observations
        ? {
            evidence_observations: read.evidence_observations.map((observation) => ({
              ...observation,
              agent_session_id: null,
            })),
          }
        : {}),
      notes: read.notes,
      observations: read.observations,
      cursor: read.cursor,
    }),
  },
  records: {
    schema: 'BatchRecords',
    project: (read: BatchRecordsDto): BatchRecordsDto => ({
      batch_id: read.batch_id,
      revision: read.revision,
      counts: read.counts,
      records: read.records,
    }),
  },
}
