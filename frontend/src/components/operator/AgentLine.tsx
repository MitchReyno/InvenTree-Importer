import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import { WORK_STEPS, type LotStatus } from '../../processing/source'
import { space } from '../../theme/generated/tokens'
import { SESSION_STATE } from '../processing/ProcessingParts'
import { Pill } from '../ui/Pill'
import { Link } from '../ui/primitives'

/** The lot's latest agent status line in Lot details, opening its step in Processing. */
export function AgentLine({ batchId, status }: { batchId: string; status: LotStatus | null }) {
  if (!status) {
    return null
  }
  const step = WORK_STEPS.find((item) => item.step === status.step)?.label ?? status.step
  return (
    <Line>
      <span>
        {step} · {status.text}
      </span>
      <Pill tone={SESSION_STATE[status.state].tone}>{SESSION_STATE[status.state].word}</Pill>
      <Link href={batchHref(batchId, { tab: 'processing', step: status.step })}>
        Open in Processing
      </Link>
    </Line>
  )
}

const Line = styled.p`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  margin: 0;
`
