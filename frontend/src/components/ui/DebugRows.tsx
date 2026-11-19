import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, type } from '#/theme/generated/tokens'

export type DebugRow = {
  label: string
  value: ReactNode
  /** A stable identity when labels can repeat, such as a lot ID. */
  key?: string
}

/** A label and value list in the debug style, used by `DebugDetails` and `DebugPanel`. */
export function DebugRows({ rows }: { rows: DebugRow[] }) {
  return (
    <Rows>
      {rows.map((row) => (
        <Row key={row.key ?? row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </Row>
      ))}
    </Rows>
  )
}

const Rows = styled.dl`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  gap: ${space[1]} ${space[4]};
  margin: 0;
`

const Row = styled.div`
  display: contents;
  dt {
    color: ${color.muted};
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    ${type.mono}
  }
`
