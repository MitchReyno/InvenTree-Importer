import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { motion, stillWhenReduced } from './motion'
import { VisuallyHidden } from './VisuallyHidden'

type Props = {
  /** The thin progress line, after a refresh has taken 400 ms. */
  line: boolean
  /** The "Updating…" words, after 3 s. */
  status: boolean
}

/**
 * Refresh progress in a zero-height layer at the top of the page, so it never moves the content:
 * a 2 px line under the masthead and, for a long refresh, "Updating…" at the page header's edge.
 */
export function RefreshLine({ line, status }: Props) {
  return (
    <Anchor data-testid="refresh-anchor">
      {line && (
        <>
          <Line data-testid="refresh-line" aria-hidden="true" />
          <VisuallyHidden role="status">Updating</VisuallyHidden>
        </>
      )}
      {status && <Status aria-hidden="true">Updating…</Status>}
    </Anchor>
  )
}

const Anchor = styled.div`
  position: sticky;
  top: 0;
  z-index: 4;
  height: 0;
`

const Line = styled.div`
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(90deg, transparent, ${color.accent}, transparent);
  background-size: 200% 100%;
  ${motion.sweep}
  ${stillWhenReduced}
`

const Status = styled.span`
  position: absolute;
  top: ${space[4]};
  right: ${space[8]};
  padding: ${space[1]} ${space[4]};
  border-radius: ${radius.btn};
  background: ${color.surface};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
