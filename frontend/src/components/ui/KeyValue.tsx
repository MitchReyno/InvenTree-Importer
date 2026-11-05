import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, font, space } from '../../theme/generated/tokens'
import { InlineEdit } from './InlineEdit'
import { media } from './media'

export type ValueState = 'plain' | 'edited' | 'override' | 'inherited'

export type KeyValueRow = {
  label: string
  value: string
  source?: ReactNode
  state: ValueState
  mono?: boolean
  onEdit?: (value: string) => void
}

const STATE_NOTE: Record<ValueState, string | null> = {
  plain: null,
  edited: '· edited',
  override: '· overrides batch',
  inherited: '· from batch',
}

function Value({ row }: { row: KeyValueRow }) {
  const note = STATE_NOTE[row.state]

  return (
    <>
      <ValueText $state={row.state} $mono={row.mono ?? false}>
        {row.value}
      </ValueText>
      {note && <Note $state={row.state}>{note}</Note>}
    </>
  )
}

/** Labelled values. Part numbers are never truncated. */
export function KeyValue({ rows }: { rows: KeyValueRow[] }) {
  return (
    <List>
      {rows.map((row) => (
        <Row key={row.label}>
          <dt>{row.label}</dt>
          <dd>
            {row.onEdit ? (
              <Editable>
                <InlineEdit label={row.label} value={row.value} onSave={row.onEdit} mono={row.mono}>
                  <Value row={row} />
                </InlineEdit>
                {row.source}
              </Editable>
            ) : (
              <Static>
                <Value row={row} />
                {row.source}
              </Static>
            )}
          </dd>
        </Row>
      ))}
    </List>
  )
}

const List = styled.dl`
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  gap: ${space[1]} ${space['2-5']};
  align-items: start;
  margin: 0;
  ${media.compact} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Row = styled.div`
  display: contents;
  dt {
    padding-top: 5px;
    font-size: 12.5px;
    color: ${color.muted};
  }
  dd {
    margin: 0;
    min-width: 0;
  }
`

const Static = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[1]} ${space[2]};
  padding: 3px ${space['1-5']};
  margin: 0 -6px;
`

// The source chip is its own button, so it sits beside the edit trigger rather than inside it.
const Editable = styled.div`
  display: flex;
  align-items: baseline;
  gap: ${space[2]};
  min-width: 0;
  & > button:first-child {
    flex: 0 1 auto;
    width: auto;
  }
`

const ValueText = styled.span<{ $state: ValueState; $mono: boolean }>`
  font-weight: 500;
  overflow-wrap: anywhere;
  ${({ $mono }) =>
    $mono &&
    css`
      font-family: ${font.mono};
      font-size: 12.5px;
    `}
  ${({ $state }) =>
    $state === 'edited' &&
    css`
      text-decoration: underline;
      text-decoration-color: ${color.accent};
      text-decoration-thickness: 2px;
      text-underline-offset: 3px;
    `}
`

const Note = styled.span<{ $state: ValueState }>`
  font-size: 12px;
  color: ${({ $state }) => ($state === 'override' ? color.warn : color.muted)};
`
