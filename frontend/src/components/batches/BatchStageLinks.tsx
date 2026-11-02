import styled from 'styled-components'
import { Link } from '../ui/primitives'

interface Props {
  batchId: string
  title: string
}

export function BatchStageLinks({ batchId, title }: Props) {
  return (
    <Stages aria-label={`Open ${title}`}>
      <Link href={`#${batchId}/capture`}>Capture</Link>
      <Link href={`#${batchId}/processing/overview`}>Processing</Link>
      <Link href={`#${batchId}/review`}>Review</Link>
      <Link href={`#${batchId}/results`}>Results</Link>
    </Stages>
  )
}

const Stages = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 13px;
    font-weight: 550;
  }
`
