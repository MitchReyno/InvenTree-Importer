import { useEffect, useState } from 'react'
import { useServerScope } from '#/context'
import { snapshots } from './snapshots'
import type { SnapshotData, SnapshotKind } from './snapshot-projections'

/**
 * The snapshot this page stored for its resource in this scope, read once when it mounts. It is
 * display-only: it never enters the query cache, so it can never verify a command.
 */
export function useRestoredSnapshot<K extends SnapshotKind>(
  kind: K,
  resourceId: string,
): SnapshotData[K] | undefined {
  const scope = useServerScope()
  const [restored] = useState(() => snapshots.read(kind, scope, resourceId))

  return restored
}

/** Stores each verified read of an allowlisted resource; pass nothing until a read is verified. */
export function useSnapshotWriter<K extends SnapshotKind>(
  kind: K,
  resourceId: string,
  verifiedRead: SnapshotData[K] | undefined,
) {
  const scope = useServerScope()

  // Session storage is the external system this keeps in step with the verified read.
  useEffect(() => {
    if (verifiedRead !== undefined) {
      snapshots.write(kind, scope, resourceId, verifiedRead)
    }
  }, [kind, scope, resourceId, verifiedRead])
}
