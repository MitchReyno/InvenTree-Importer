import styled from 'styled-components'
import { linkTouchArea, Pill } from '#/components/ui'

/** The step rows in Settings › Agents. */
const STEP_ROWS_HREF = '#settings/agents/models'

/**
 * A step header's warning that its saved model is one the provider's current list no longer
 * offers, linking to the step's row in Settings › Agents.
 */
export function NotOfferedPill({ name }: { name: string }) {
  return (
    <PillLink href={STEP_ROWS_HREF} title="Pick another model in Settings › Agents">
      <Pill tone="warn" glyph="!">
        Not offered: {name}
      </Pill>
    </PillLink>
  )
}

// The step header pushes its last link to the end; this one stays beside the title.
const PillLink = styled.a`
  && {
    margin-left: 0;
  }
  text-decoration: none;
  ${linkTouchArea}
`
