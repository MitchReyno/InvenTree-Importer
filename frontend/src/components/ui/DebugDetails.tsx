import type { ReactNode } from 'react'
import styled from 'styled-components'
import { useDebugMode } from '#/debug/debug-mode'
import { color, radius, space, type } from '#/theme/generated/tokens'

export type DebugRow = {
  label: string
  value: ReactNode
}

type DebugDetailsProps = {
  /** Names the block for assistive technology, e.g. "Round details". */
  label: string
  /** Label and value pairs; values render in the mono face. */
  rows?: DebugRow[]
  children?: ReactNode
}

/**
 * Technical details (IDs, revisions, hashes, raw codes) shown only in debug mode, as a dashed
 * block marked "Debug" set apart from the operator content around it.
 */
export function DebugDetails({ label, rows, children }: DebugDetailsProps) {
  const { enabled } = useDebugMode()

  if (!enabled) {
    return null
  }

  return (
    <Block role="group" aria-label={`Debug: ${label}`}>
      <Tag aria-hidden="true">Debug</Tag>
      {rows && rows.length > 0 && <DebugRows rows={rows} />}
      {children}
    </Block>
  )
}

/** A label and value list in the debug style; shared with `DebugPanel`. */
export function DebugRows({ rows }: { rows: DebugRow[] }) {
  return (
    <Rows>
      {rows.map((row) => (
        <Row key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </Row>
      ))}
    </Rows>
  )
}

const Block = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  min-width: 0;
  padding: ${space[3]} ${space[4]};
  border: 1px dashed ${color.devLine};
  border-radius: ${radius.sm};
  background: ${color.devBg};
  color: ${color.fg};
  overflow-wrap: anywhere;
  ${type.small}
  p {
    margin: 0;
  }
`

const Tag = styled.span`
  align-self: flex-start;
  color: ${color.devFg};
  ${type.label}
`

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
