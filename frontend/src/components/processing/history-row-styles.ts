import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'

/** A history row's border marks the operator's and the app's inputs, as chat puts them right. */
const inputMark = ({ $input }: { $input: boolean }) => ($input ? color.accent : 'transparent')

export const HistoryLine = styled.div<{ $input: boolean }>`
  min-width: 0;
  overflow-wrap: anywhere;
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]} ${space[3]};
  padding: ${space[2]} ${space[3]};
  border-left: 2px solid ${inputMark};
`

export const HistoryDetails = styled.details<{ $input: boolean }>`
  min-width: 0;
  overflow-wrap: anywhere;
  padding: ${space[2]} ${space[3]};
  border-radius: ${radius.sm};
  border-left: 2px solid ${inputMark};
  > summary {
    display: flex;
    flex-wrap: wrap;
    gap: ${space[1]} ${space[3]};
    cursor: pointer;
  }
  &[open] {
    background: ${color.surface2};
  }
`

export const HistoryText = styled.span`
  flex: 1 1 12rem;
  min-width: 0;
`

export const HistoryTime = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

export const HistoryRows = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[2]};
  min-width: 0;
`
