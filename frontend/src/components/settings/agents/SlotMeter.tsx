import styled from 'styled-components'
import type { AgentSessionListDto } from '@invimport/contracts'
import { Link, Small } from '#/components/ui'
import { slotUse } from '#/components/agents/slot-use'
import { space, typeVar } from '#/theme/generated/tokens'

type SlotMeterProps = {
  list: AgentSessionListDto | undefined
  failed: boolean
  /** The saved limit, which the server applies; an unsaved stepper value isn't in force yet. */
  limit: number
}

/** "3 of 3 in use · 1 queued", from the agent sessions list, with a link to it. */
export function SlotMeter({ list, failed, limit }: SlotMeterProps) {
  if (failed) {
    return <Small>Slot use unavailable.</Small>
  }
  if (!list || list.sessions_supported === false) {
    return null
  }
  const { inUse, queued } = slotUse(list.sessions)
  const use =
    queued > 0 ? `${inUse} of ${limit} in use · ${queued} queued` : `${inUse} of ${limit} in use`

  return (
    <Meter>
      <span>{use}</span>
      <Link href="#agents">See sessions</Link>
    </Meter>
  )
}

const Meter = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  gap: ${space[4]};
  font-size: ${typeVar.small.size};
`
