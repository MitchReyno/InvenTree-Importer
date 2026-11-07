import styled, { css } from 'styled-components'

/** Read by assistive technology but not drawn; also used inside media queries. */
export const visuallyHidden = css`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
`

export const VisuallyHidden = styled.span`
  ${visuallyHidden}
`
