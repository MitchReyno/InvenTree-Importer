import type { PoolClient } from 'pg'
import { validate, type MediaSnapshotDto } from '@invimport/contracts'
import { captureInTransaction, type CaptureBinding } from '../capture/repository.ts'
import {
  projectMediaSnapshot,
  type MediaRows,
  type VersionRow,
  type PreviewRow,
  type DerivationRow,
} from './projection.ts'

async function readMediaRows(client: PoolClient, batchId: string): Promise<MediaRows> {
  const revision = await client.query<{ revision: string }>(
    'SELECT revision FROM media_batch WHERE batch_id=$1',
    [batchId],
  )
  const evidence = await client.query<MediaRows['evidence'][number]>(
    'SELECT id,label FROM media_evidence WHERE batch_id=$1 ORDER BY created_at,id',
    [batchId],
  )
  const versions = await client.query<VersionRow>(
    `SELECT v.id,v.evidence_id,v.kind,v.blob_digest,v.media_type,v.recipe_bytes,
            v.recipe_digest,b.byte_size,r.state,r.decoder_build
     FROM media_version v JOIN media_blob b ON b.digest=v.blob_digest
     LEFT JOIN media_decode_command c ON
       (v.kind='original' AND c.version_id=v.id AND c.derivation_id IS NULL)
       OR (v.kind='derived' AND c.derivation_id=v.id)
     LEFT JOIN media_decode_result r ON r.command_id=c.id
     WHERE v.batch_id=$1 ORDER BY v.created_at,v.id`,
    [batchId],
  )
  const previews = await client.query<PreviewRow>(
    'SELECT id,version_id,page,width,height FROM media_preview WHERE batch_id=$1 ORDER BY page',
    [batchId],
  )
  const groups = await client.query<MediaRows['groups'][number]>(
    'SELECT id,label FROM media_group WHERE batch_id=$1 ORDER BY id',
    [batchId],
  )
  const membership = await client.query<MediaRows['membership'][number]>(
    `SELECT DISTINCT ON(evidence_id) evidence_id,group_id FROM media_group_selection
     WHERE batch_id=$1 ORDER BY evidence_id,revision DESC`,
    [batchId],
  )
  const links = await client.query<MediaRows['links'][number]>(
    `SELECT DISTINCT ON(evidence_id,subject_id) evidence_id,subject_id,linked
     FROM media_subject_link WHERE batch_id=$1 ORDER BY evidence_id,subject_id,revision DESC`,
    [batchId],
  )
  const attachments = await client.query<MediaRows['attachments'][number]>(
    `SELECT DISTINCT ON(subject_id) id,subject_id,mode,version_id,destination
     FROM media_attachment_selection WHERE batch_id=$1 ORDER BY subject_id,revision DESC`,
    [batchId],
  )
  const derivations = await client.query<DerivationRow>(
    `SELECT d.id,d.evidence_id,d.recipe_bytes,d.recipe_digest,r.state,v.id AS produced_version_id
     FROM media_derivation d JOIN media_decode_command c ON c.derivation_id=d.id
     LEFT JOIN media_decode_result r ON r.command_id=c.id
     LEFT JOIN media_version v ON v.id=d.id
     WHERE d.batch_id=$1 ORDER BY d.created_at,d.id`,
    [batchId],
  )
  return {
    revision: revision.rows[0]?.revision ?? '1',
    evidence: evidence.rows,
    versions: versions.rows,
    previews: previews.rows,
    groups: groups.rows,
    membership: membership.rows,
    links: links.rows,
    attachments: attachments.rows,
    derivations: derivations.rows,
  }
}

/** Authorization precedes relational reads; schema validation checks the complete projection. */
export async function mediaSnapshot(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
): Promise<MediaSnapshotDto> {
  await captureInTransaction(client, binding, batchId)
  const rows = await readMediaRows(client, batchId)
  const snapshot = projectMediaSnapshot(batchId, rows)
  validate('MediaSnapshot', snapshot)
  return snapshot
}
