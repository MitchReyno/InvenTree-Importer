import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { join } from 'node:path'
import { isolatedDatabase, seedAuthority } from '../../tests/support/database.ts'
import { grantFoundation, grantProjection } from '#/operations/grants.ts'
import { grantCapture, grantCaptureRead } from '#/capture/grants.ts'
import { grantManual } from '#/review/grants.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantProcessing } from '#/processing/grants.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { BlobStore } from '#/media/blob-store.ts'
import type { LocalDevState, ReadOnlyDevState } from './state.ts'
import type { DevelopmentTarget } from './target.ts'

type ReadTarget = Extract<DevelopmentTarget, { kind: 'read-only' | 'local-inventree' }>

/** Provision only local app authority. No target token, network read or apply deployment. */
export async function readonlyState(
  root: string,
  target: ReadTarget,
  instanceId?: string,
): Promise<ReadOnlyDevState | LocalDevState> {
  const db = await isolatedDatabase({ retainedDev: true })
  try {
    const identity = await seedAuthority(db.pool, {
      profile: 'protected-read-only',
      // A reset local instance is a different target context.
      contextHash: createHash('sha256')
        .update(JSON.stringify(target.kind === 'local-inventree' ? { target, instanceId } : target))
        .digest(),
    })
    const blobRoot = join(root, 'retained/blobs')
    await BlobStore.initialize(blobRoot, await readMediaStoreIdentity(db.pool))

    async function role(purpose: 'api' | 'processing' | 'media' | 'scheduler') {
      const name = `intake_${randomUUID().replaceAll('-', '')}`
      const password = randomUUID()
      await db.pool.query(
        `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 6`,
      )
      if (purpose === 'scheduler') {
        await db.pool.query(`GRANT CREATE ON DATABASE ${db.name} TO ${name}`)
      } else if (purpose === 'api') {
        await grantFoundation(db.pool, name)
        await grantCapture(db.pool, name)
        await grantManual(db.pool, name, 'api')
        await grantMedia(db.pool, name, 'api')
        await grantProcessing(db.pool, name)
      } else if (purpose === 'processing') {
        await grantProcessing(db.pool, name, 'runner')
      } else {
        await grantMedia(db.pool, name, 'decoder')
        await grantProjection(db.pool, name)
        await grantCaptureRead(db.pool, name)
        await db.pool.query(`GRANT UPDATE(revision) ON media_batch TO ${name}`)
      }
      const url = new URL(db.url)
      url.username = name
      url.password = password
      return url.toString()
    }

    const common = {
      databaseName: db.name,
      identity,
      apiUrl: await role('api'),
      processingUrl: await role('processing'),
      mediaUrl: await role('media'),
      schedulerUrl: await role('scheduler'),
      blobRoot,
      channelSecret: randomBytes(32).toString('hex'),
    }
    if (target.kind === 'local-inventree') {
      if (!instanceId) {
        throw new Error('local_inventree_instance_required')
      }
      return { version: 3, instanceId, target, ...common }
    }
    return { version: 2, target, ...common }
  } finally {
    await db.close()
  }
}
