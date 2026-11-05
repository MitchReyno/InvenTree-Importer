import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import { color, radius, space } from '../../theme/generated/tokens'
import { media } from '../ui/media'

interface Props {
  batchId: string
  title: string
}

/** Direct links to a batch's four tabs. */
export function BatchStageLinks({ batchId, title }: Props) {
  return (
    <Stages aria-label={`Open ${title}`}>
      <a href={batchHref(batchId, { tab: 'capture' })}>Capture</a>
      <a href={batchHref(batchId, { tab: 'processing', step: 'overview' })}>Processing</a>
      <a href={batchHref(batchId, { tab: 'review', view: 'lots' })}>Review</a>
      <a href={batchHref(batchId, { tab: 'changes', view: 'ready' })}>Changes</a>
    </Stages>
  )
}

const Stages = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[1]};
  a {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 ${space[2]};
    border-radius: ${radius.btn};
    color: ${color.accent};
    font-size: 12.5px;
    font-weight: 500;
    text-decoration: none;
  }
  a:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    a {
      min-height: 44px;
    }
  }
`
