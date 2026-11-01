import type { PoolClient } from 'pg'
import type { ProcessingConfig } from './attempts.ts'
import { loadProcessingAuthority } from './authority.ts'
import { MAX_JOBS_PER_BATCH } from './limits.ts'
import { fail, stageOrder } from './model.ts'

type ProcessingAuthority = Awaited<ReturnType<typeof loadProcessingAuthority>>

interface DependencyStatus {
  current: boolean
  ready: boolean
}

const currentDependencyStates = new Set([
  'queued',
  'running',
  'waiting_for_user',
  'waiting_for_login',
  'waiting_for_capacity',
  'ready',
])

async function retainedDependencyClosure(
  client: PoolClient,
  config: ProcessingConfig,
  root: ProcessingAuthority,
): Promise<ProcessingAuthority[]> {
  const retained = new Map<string, ProcessingAuthority>([[root.row.id, root]])
  const pending = [root]
  const dependencies: ProcessingAuthority[] = []

  for (let index = 0; index < pending.length; index += 1) {
    const successor = pending[index]
    for (const dependencyId of successor.manifest.dependencies) {
      let predecessor = retained.get(dependencyId)
      if (!predecessor) {
        if (retained.size >= MAX_JOBS_PER_BATCH) {
          fail('processing_dependency_capacity')
        }
        predecessor = await loadProcessingAuthority(client, config, dependencyId)
        retained.set(dependencyId, predecessor)
        pending.push(predecessor)
        dependencies.push(predecessor)
      }
      const sameBatch = predecessor.manifest.batch_id === root.manifest.batch_id
      const increasingStage =
        stageOrder.indexOf(predecessor.manifest.stage) <
        stageOrder.indexOf(successor.manifest.stage)
      if (!sameBatch || !increasingStage) {
        fail('processing_dependency_binding_invalid')
      }
    }
  }

  return dependencies
}

/** Exact predecessor IDs never redirect. Queued predecessors can be current without being ready. */
export async function processingDependencyStatus(
  client: PoolClient,
  config: ProcessingConfig,
  authority: ProcessingAuthority,
): Promise<DependencyStatus> {
  const dependencies = await retainedDependencyClosure(client, config, authority)
  if (dependencies.length === 0) {
    return { current: true, ready: true }
  }

  // Predecessors are exact accepted historical inputs. An explicit answer can create a fresh
  // consumer input while retaining its selected ready predecessors; only that consumer's own
  // capture/media closure is compared with the latest snapshot by the caller.
  let current = true
  let ready = true
  for (const dependency of dependencies) {
    const selected = dependency.row.current_attempt_id === dependency.row.id
    const consistentState = dependency.row.job_state === dependency.row.state
    const dependencyCurrent =
      selected && consistentState && currentDependencyStates.has(dependency.row.state)
    current = current && dependencyCurrent
    ready = ready && dependencyCurrent && dependency.row.state === 'ready'
  }

  return { current, ready }
}
