import {
  executorAttachmentIntents,
  executorAttachmentResults,
  executorAttachmentEffects,
  executorAttachmentVerifications,
} from '#/execution/schema.ts'
import {
  manualPrepareCommands,
  manualReadIntents,
  manualReadResults,
  manualPreparationReviews,
  manualPrepareOutcomes,
  manualRuns,
  manualDispatches,
} from '#/review/schema.ts'
import {
  captureSources,
  captureParts,
  captureLots,
  captureNotes,
  captureSelections,
  captureRevisions,
  captureEditPublications,
} from '#/capture/schema.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { targets, streams } from '#/db/schema.ts'
import { captureObservations, captureBatches, captureSubjects } from '#/capture/schema.ts'
import {
  executorDeployments,
  executorSources,
  executorGuards,
  executorApprovals,
  executorRuns,
  executorOperations,
  executorCancels,
  executorRecoveries,
  executorIntents,
  executorResults,
  executorEffects,
  executorVerifications,
  executorAttachments,
  executorAttachmentRecoveries,
} from '#/execution/schema.ts'
import {
  manualReviews,
  manualPreparations,
  manualApprovals,
  manualPreparationLots,
  manualPreparationMedia,
} from '#/review/schema.ts'
import { isolatedDatabase } from '../support/database.ts'
import { manualFixture } from '../support/manual.ts'
import { stockDeployment } from '#/execution/source.ts'

test('domain driver mappings match the migrated PostgreSQL columns, keys and defaults', async () => {
  const db = await isolatedDatabase()
  try {
    const tables = [
      targets,
      streams,
      captureSources,
      captureParts,
      captureLots,
      captureNotes,
      captureSelections,
      captureRevisions,
      captureEditPublications,
      manualPrepareCommands,
      manualReadIntents,
      manualReadResults,
      manualPreparationReviews,
      manualPrepareOutcomes,
      manualRuns,
      manualDispatches,
      executorAttachmentIntents,
      executorAttachmentResults,
      executorAttachmentEffects,
      executorAttachmentVerifications,
      captureObservations,
      captureBatches,
      captureSubjects,
      executorDeployments,
      executorSources,
      executorGuards,
      executorApprovals,
      executorRuns,
      executorOperations,
      executorCancels,
      executorRecoveries,
      executorIntents,
      executorResults,
      executorEffects,
      executorVerifications,
      executorAttachments,
      executorAttachmentRecoveries,
      manualReviews,
      manualPreparations,
      manualApprovals,
      manualPreparationLots,
      manualPreparationMedia,
    ]
    for (const table of tables) {
      const config = getTableConfig(table)
      for (const column of config.columns) {
        if (column.getSQLType() === 'bigint') {
          assert.equal(column.dataType, 'bigint', `${config.name}.${column.name}`)
        }
      }
      const actual = await db.pool.query<{
        name: string
        type: string
        not_null: boolean
        has_default: boolean
      }>(
        `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
                a.attnotnull AS not_null,(d.oid IS NOT NULL OR a.attidentity<>'') AS has_default
         FROM pg_attribute a
         JOIN pg_class c ON c.oid=a.attrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
         WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped
         ORDER BY a.attname`,
        [config.name],
      )
      const declared = config.columns
        .map((column) => ({
          name: column.name,
          type: column.getSQLType(),
          not_null: column.notNull,
          has_default: column.hasDefault,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      assert.deepEqual(declared, actual.rows, config.name)
      const actualKey = await db.pool.query<{ name: string }>(
        `SELECT a.attname AS name
         FROM pg_constraint k
         JOIN pg_class c ON c.oid=k.conrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
         CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY AS key(attnum,position)
         JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=key.attnum
         WHERE n.nspname='public' AND c.relname=$1 AND k.contype='p'
         ORDER BY key.position`,
        [config.name],
      )
      const declaredKey = [
        ...config.columns.filter((column) => column.primary).map((column) => column.name),
        ...config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
      ]
      assert.deepEqual(
        declaredKey,
        actualKey.rows.map((column) => column.name),
        config.name,
      )
    }
  } finally {
    await db.dispose()
  }
})

test('deployment joins retain an exact target revision above the safe integer range', async () => {
  const fixture = await manualFixture()
  try {
    const revision = '9007199254740993'
    await fixture.db.pool.query('UPDATE target SET revision=$2 WHERE id=$1', [
      fixture.identity.target,
      revision,
    ])
    const client = await fixture.db.pool.connect()
    try {
      const deployment = await stockDeployment(client, {
        deploymentId: fixture.runnerConfig.deploymentId,
        targetId: fixture.identity.target,
        contextId: fixture.identity.context,
        origin: fixture.fake.origin,
      })
      assert.equal(deployment?.targetRevision, revision)
    } finally {
      client.release()
    }
  } finally {
    await fixture.dispose()
  }
})
