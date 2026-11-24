import type { PoolClient } from 'pg'
import type {
  CaptureSnapshotDto,
  ProcessingInputV7Dto,
  SessionBriefDto,
  SessionBriefPageDto,
} from '@invimport/contracts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { MediaInputContextDto } from '@invimport/contracts/media'
import { readBatchMediaInputResult, readMediaInputScopeResults } from '#/media/inputs.ts'
import { removedVersionIds } from '#/media/removal.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { assembleBrief, type BriefVersion } from '#/processing/brief.ts'
import {
  briefDigest,
  briefPages,
  keepCurrentView,
  keptCurrentView,
  pageToken,
  readPageToken,
  sealedBriefPage,
  type BriefPageCursor,
} from '#/processing/brief-pages.ts'
import { ProcessingError, processingSubjectScope } from '#/processing/model.ts'
import { briefScope } from '#/processing/session-input.ts'
import type { SessionPrincipal } from './capability.ts'
import { refuse, ToolRefusal } from './refusal.ts'

/** What a read asks for: a page token, the sealed revision, or (with neither) the current view. */
export interface BriefReadRequest {
  revision?: string
  page_token?: string
}

type StagePrincipal = SessionPrincipal & { manifest: ProcessingInputV7Dto }

const UNAVAILABLE =
  'That brief revision is no longer kept. Read the current view again without a page_token.'

/** The principal of a `/7` session, or a refusal for an earlier session, which has no brief. */
export function stagePrincipal(principal: SessionPrincipal): StagePrincipal {
  if (principal.manifest.schema_version !== 'bench-intake-input/7') {
    refuse('tool_not_allowed', 'Only stage sessions have a brief to read.')
  }
  return principal as StagePrincipal
}

/**
 * The versions the session may fetch now: those its input pinned (originals only for the lead)
 * and those sent to it since as evidence notices, less any the operator removed.
 */
async function currentVersions(client: PoolClient, principal: StagePrincipal) {
  const sealed = briefScope(principal.manifest).versions
  const notices = await client.query<{
    evidence_id: string
    version_id: string
    digest: string
    media_type: string
  }>(
    `SELECT v.evidence_id,v.id AS version_id,encode(v.blob_digest,'hex') AS digest,v.media_type
     FROM public.agent_session_inbox i
     JOIN public.media_version v ON v.id=(i.payload->>'version_id')::uuid AND v.batch_id=$2
     WHERE i.session_lineage_id=$1 AND i.kind='evidence'
     ORDER BY i.seq`,
    [principal.lineageId, principal.batchId],
  )
  const versions: BriefVersion[] = [...sealed]
  for (const row of notices.rows) {
    if (!versions.some((version) => version.versionId === row.version_id)) {
      versions.push({
        evidenceId: row.evidence_id,
        versionId: row.version_id,
        digest: row.digest,
        mediaType: row.media_type,
      })
    }
  }
  const removed = await removedVersionIds(
    client,
    principal.batchId,
    versions.map((version) => version.versionId),
  )
  return versions.filter((version) => !removed.has(version.versionId))
}

/**
 * The group and evidence notes of the session's media scope now; the sealed ones when the scope
 * can't be read (its media isn't ready, or is over the input limits).
 */
async function currentMediaContext(
  client: PoolClient,
  config: ProcessingConfig,
  principal: StagePrincipal,
  snapshot: CaptureSnapshotDto,
  sealed: MediaInputContextDto | undefined,
) {
  const lotId = principal.manifest.subject_id
  const result =
    lotId === null
      ? await readBatchMediaInputResult(client, config, principal.batchId)
      : (
          await readMediaInputScopeResults(client, config, principal.batchId, [
            processingSubjectScope(snapshot, lotId),
          ])
        )[0]
  return result.kind === 'ready' ? result.inputs.context : sealed
}

/** The session's brief as it would be sealed now, from current capture and retained state. */
async function currentBrief(
  client: PoolClient,
  config: ProcessingConfig,
  principal: StagePrincipal,
): Promise<SessionBriefDto> {
  const capture = await captureInTransaction(client, config, principal.batchId)
  const sealed = briefScope(principal.manifest)
  const scope = {
    ...sealed,
    versions: await currentVersions(client, principal),
    mediaContext: await currentMediaContext(
      client,
      config,
      principal,
      capture.snapshot,
      sealed.mediaContext,
    ),
  }
  return assembleBrief(client, capture.snapshot, scope)
}

/** The cursor a read starts from, keeping the current view when it asks for that. */
async function startingCursor(
  client: PoolClient,
  principal: StagePrincipal,
  request: BriefReadRequest,
  current: SessionBriefDto,
): Promise<BriefPageCursor> {
  const sealed = principal.manifest.brief
  if (request.page_token !== undefined) {
    const cursor = readPageToken(request.page_token)
    if (!cursor || cursor.attemptId !== principal.attemptId) {
      throw new ToolRefusal('validation_failed', 'That page_token is not one of this session’s.', [
        { path: '/page_token', rule: 'schema', reason: 'Use a page_token this session was given.' },
      ])
    }
    return cursor
  }
  if (request.revision !== undefined) {
    if (request.revision !== sealed.revision) {
      refuse('brief_revision_unavailable', UNAVAILABLE)
    }
    return { attemptId: principal.attemptId, view: 'sealed', digest: sealed.sha256, page: 1 }
  }
  if (!(await keepCurrentView(client, principal.attemptId, current))) {
    refuse('brief_revision_unavailable', UNAVAILABLE)
  }
  return {
    attemptId: principal.attemptId,
    view: 'current',
    digest: briefDigest(current),
    page: 1,
  }
}

/** The pages of the view a cursor names: the sealed brief's, or a kept current view's. */
async function viewPage(client: PoolClient, principal: StagePrincipal, cursor: BriefPageCursor) {
  const sealed = principal.manifest.brief
  if (cursor.view === 'sealed') {
    if (cursor.digest !== sealed.sha256 || cursor.page > sealed.pages.length) {
      refuse('brief_revision_unavailable', UNAVAILABLE)
    }
    return {
      header: sealed,
      pageCount: sealed.pages.length,
      entries: await sealedBriefPage(client, principal.inputId, sealed, cursor.page),
    }
  }
  const kept =
    (await keptCurrentView(client, principal.attemptId, cursor.digest)) ??
    refuse('brief_revision_unavailable', UNAVAILABLE)
  const pages = briefPages(kept)
  if (cursor.page > pages.length) {
    refuse('brief_revision_unavailable', UNAVAILABLE)
  }
  return {
    header: { ...kept, sha256: cursor.digest },
    pageCount: pages.length,
    entries: pages[cursor.page - 1].page.entries,
  }
}

/**
 * One page of a `/7` session's brief. A page token continues the view it came from, even after
 * an edit; each page says whether the current brief differs from it.
 */
export async function readBriefPage(
  client: PoolClient,
  config: ProcessingConfig,
  principal: StagePrincipal,
  request: BriefReadRequest,
): Promise<SessionBriefPageDto> {
  try {
    const current = await currentBrief(client, config, principal)
    const cursor = await startingCursor(client, principal, request, current)
    const { header, pageCount, entries } = await viewPage(client, principal, cursor)
    const currentDigest = briefDigest(current)
    return {
      view: cursor.view,
      stage: header.stage,
      lot_id: header.lot_id,
      revision: header.revision,
      sha256: cursor.digest,
      sections: header.sections,
      page: cursor.page,
      page_count: pageCount,
      entries,
      next_page_token:
        cursor.page < pageCount ? pageToken({ ...cursor, page: cursor.page + 1 }) : null,
      newer: currentDigest === cursor.digest ? null : { revision: current.revision },
    }
  } catch (error) {
    // A brief past the page bound can't be kept or paged; the session reads again later.
    if (error instanceof ProcessingError && error.code === 'processing_input_capacity') {
      refuse('brief_revision_unavailable', UNAVAILABLE)
    }
    throw error
  }
}
