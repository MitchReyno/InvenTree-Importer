import styled from 'styled-components'
import type { SessionFailureSummaryDto } from '@invimport/contracts'
import { HelpButton } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import { FailureLine } from './FailureLine'

/** A failure's cause and when, with its category's advice once, behind a help button. */
export function FailureSummary({ failure }: { failure?: SessionFailureSummaryDto }) {
  return (
    <Summary>
      <FailureLine failure={failure} />
      {failure && <HelpButton label="What to do" explanation={failure.recovery} />}
    </Summary>
  )
}

const Summary = styled.div`
  display: flex;
  align-items: start;
  gap: ${space[3]};
  min-width: 0;
`
