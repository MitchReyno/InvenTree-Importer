import { boolean, customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { MediaVersionDto } from '@invimport/contracts'
import type { MediaRenditionSize } from '@invimport/contracts/media'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })
// node-postgres returns bigint as exact decimal strings; retain existing DTO/command bytes.
const decimalInteger = customType<{ data: string; driverData: string }>({
  dataType: () => 'bigint',
})

// Reviewed SQL owns constraints, defaults, cycles and immutable triggers. No generated DDL.
export const mediaStoreIdentity = pgTable('media_store_identity', {
  singleton: boolean().primaryKey(),
  storeId: uuid('store_id').notNull(),
})
export const mediaBatches = pgTable('media_batch', {
  batchId: uuid('batch_id').primaryKey(),
  revision: decimalInteger()
    .notNull()
    .default(sql`1`),
})
export const mediaBlobs = pgTable('media_blob', {
  digest: bytea().primaryKey(),
  byteSize: decimalInteger('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const mediaEvidence = pgTable('media_evidence', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  label: text().notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const mediaGroups = pgTable('media_group', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  label: text().notNull(),
  actorId: uuid('actor_id').notNull(),
})
export const mediaVersions = pgTable('media_version', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  kind: text().$type<MediaVersionDto['kind']>().notNull(),
  blobDigest: bytea('blob_digest').notNull(),
  mediaType: text('media_type').$type<MediaVersionDto['media_type']>().notNull(),
  sourceVersionId: uuid('source_version_id'),
  recipeBytes: bytea('recipe_bytes'),
  recipeDigest: bytea('recipe_digest'),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const mediaDecodeCommands = pgTable('media_decode_command', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  versionId: uuid('version_id').notNull(),
  derivationId: uuid('derivation_id'),
  build: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const mediaDecodeResults = pgTable('media_decode_result', {
  commandId: uuid('command_id').primaryKey(),
  state: text().$type<MediaVersionDto['state']>().notNull(),
  decoderBuild: text('decoder_build').notNull(),
})
export const mediaPreviews = pgTable('media_preview', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  versionId: uuid('version_id').notNull(),
  commandId: uuid('command_id').notNull(),
  page: integer().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  blobDigest: bytea('blob_digest').notNull(),
})
export const mediaPreviewRenditions = pgTable('media_preview_rendition', {
  previewId: uuid('preview_id').notNull(),
  batchId: uuid('batch_id').notNull(),
  size: text().$type<MediaRenditionSize>().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  blobDigest: bytea('blob_digest').notNull(),
})
export const mediaDerivations = pgTable('media_derivation', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  sourceVersionId: uuid('source_version_id').notNull(),
  recipeBytes: bytea('recipe_bytes').notNull(),
  recipeDigest: bytea('recipe_digest').notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const mediaMemberships = pgTable('media_group_selection', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  groupId: uuid('group_id'),
  revision: decimalInteger().notNull(),
  actorId: uuid('actor_id').notNull(),
})
export const mediaLinks = pgTable('media_subject_link', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  linked: boolean().notNull(),
  revision: decimalInteger().notNull(),
  actorId: uuid('actor_id').notNull(),
})
export const mediaAttachmentSelections = pgTable('media_attachment_selection', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  subjectId: uuid('subject_id').notNull(),
  subjectKind: text('subject_kind').$type<'lot' | 'part'>().notNull().default('lot'),
  mode: text().$type<'selected' | 'declined' | 'unset'>().notNull(),
  versionId: uuid('version_id'),
  destination: text().$type<'lot_attachment' | 'part_attachment'>().notNull(),
  revision: decimalInteger().notNull(),
  actorId: uuid('actor_id').notNull(),
})

export const mediaDecodeClaims = pgTable('media_decode_claim', {
  commandId: uuid('command_id').primaryKey(),
  ownerId: uuid('owner_id').notNull(),
})

export const mediaCommandBindings = pgTable('media_command_binding', {
  commandId: uuid('command_id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  targetId: uuid('target_id').notNull(),
  targetContextId: uuid('target_context_id').notNull(),
  manifestBytes: bytea('manifest_bytes').notNull(),
  manifestDigest: bytea('manifest_digest').notNull(),
})

export const mediaCommandPins = pgTable('media_command_pin', {
  commandId: uuid('command_id').notNull(),
  batchId: uuid('batch_id').notNull(),
  versionId: uuid('version_id').notNull(),
  blobDigest: bytea('blob_digest').notNull(),
})

export const mediaGroupHistory = pgTable('media_group_history', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  groupId: uuid('group_id').notNull(),
  revision: decimalInteger().notNull(),
  label: text().notNull(),
  retired: boolean().notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const mediaEvidenceNotes = pgTable('media_evidence_note', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  revision: decimalInteger().notNull(),
  text: text().notNull(),
  actorId: uuid('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const mediaEvidenceRemovals = pgTable('media_evidence_removal', {
  id: uuid().primaryKey(),
  batchId: uuid('batch_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  revision: decimalInteger().notNull(),
  actorId: uuid('actor_id').notNull(),
  removed: boolean().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
