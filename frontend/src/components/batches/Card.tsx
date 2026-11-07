import styled from 'styled-components'
import { color, radius, space, type } from '../../theme/generated/tokens'

/** The Batches page's surface card. */
export const Card = styled.section`
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  min-width: 0;
`

export const CardTitle = styled.h2`
  margin: 0;
  ${type.h2}
  overflow-wrap: anywhere;
`
