import styled from 'styled-components'
import { color, space } from '#/theme/generated/tokens'

/** A setting's control column: the control, its notes and its Save, stacked. */
export const Stack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[4]};
  min-width: 0;
  width: 100%;
  small {
    color: ${color.muted};
  }
  textarea {
    width: 100%;
  }
`
