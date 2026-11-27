import styled from 'styled-components'
import type { SessionHistoryLinkDto } from '@invimport/contracts'
import { space, typeVar } from '#/theme/generated/tokens'
import { HistoryLink, type HistoryContext } from './HistoryLink'

/** An entry's links in one row; the same target is linked once. */
export function HistoryLinks({
  links,
  context,
}: {
  links: readonly SessionHistoryLinkDto[]
  context: HistoryContext
}) {
  const unique = new Map(links.map((link) => [JSON.stringify(link), link]))
  if (unique.size === 0) {
    return null
  }
  return (
    <Row>
      {[...unique].map(([key, link]) => (
        <HistoryLink key={key} link={link} context={context} />
      ))}
    </Row>
  )
}

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]} ${space[5]};
  font-size: ${typeVar.small.size};
`
