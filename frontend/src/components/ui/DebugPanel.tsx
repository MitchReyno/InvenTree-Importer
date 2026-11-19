import styled from 'styled-components'
import { useDebugMode } from '#/debug/debug-mode'
import { color, radius, size, space, type } from '#/theme/generated/tokens'
import { DebugRows, type DebugRow } from './DebugRows'
import { raisedOnField } from './field'

type DebugPanelProps = {
  /** The screen it describes, e.g. "Processing › Research". */
  screen: string
  /** Built during render from data the screen already holds; the panel starts no request. */
  rows: DebugRow[]
}

/** A collapsible panel of a screen's route, IDs, revisions and read state, shown only in debug mode. */
export function DebugPanel({ screen, rows }: DebugPanelProps) {
  const { enabled } = useDebugMode()

  if (!enabled) {
    return null
  }

  return (
    <Panel>
      <Summary>Debug · {screen}</Summary>
      <Body>
        <DebugRows rows={rows} />
      </Body>
    </Panel>
  )
}

const Panel = styled.details`
  min-width: 0;
  border: 1px solid ${color.devLine};
  border-radius: ${radius.card};
  background: ${color.surface};
  overflow: hidden;
  ${raisedOnField}
`

const Summary = styled.summary`
  display: flex;
  align-items: center;
  min-height: ${size.touch};
  padding: 0 ${space[4]};
  background: ${color.devBg};
  color: ${color.devFg};
  cursor: pointer;
  ${type.pill}
`

const Body = styled.div`
  padding: ${space[3]} ${space[4]};
  ${type.small}
`
