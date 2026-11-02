import {
  validate,
  type ResearchInventoryLookupDto,
  type ResearchInventoryObservationDto,
} from '@invimport/contracts'
import type { ReadOperation } from '../inventory/transport.ts'
import { captureRead } from '../capture/read.ts'
import { awaitResearchResult } from './abort.ts'
import { assertResearchActive, ResearchError } from './errors.ts'

export type ResearchInventoryRead = (operation: {
  kind: 'get_part' | 'get_location'
  pk: string
}) => Promise<Response>

/** This closure contains no mutation methods or credentials; parsing reuses qualified capture reads. */
export function researchInventoryReader(read: ResearchInventoryRead) {
  const observe = captureRead(researchInventoryReadAdapter(read))
  return async function lookupInventory(
    request: ResearchInventoryLookupDto,
    signal: AbortSignal,
  ): Promise<ResearchInventoryObservationDto> {
    validate('ResearchInventoryLookup', request)
    assertResearchActive(signal)
    try {
      const result = await awaitResearchResult(observe(request), signal)
      assertResearchActive(signal)
      const observation = { ...request, label: result.label }
      validate('ResearchInventoryObservation', observation)
      return observation
    } catch (error) {
      if (signal.aborted) {
        throw new ResearchError('research_cancelled')
      }
      throw new ResearchError('research_inventory_unavailable', { cause: error })
    }
  }
}

/** The research vocabulary stays narrow when capture adds catalogue reads. */
export function researchInventoryReadAdapter(read:ResearchInventoryRead) {
  return (operation:ReadOperation) => {
    if(operation.kind!=='get_part'&&operation.kind!=='get_location') {throw new ResearchError('research_inventory_unavailable')}
    return read({kind:operation.kind,pk:operation.pk})
  }
}
