import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { media, visuallyHidden } from '#/components/ui'

/** The development build's badge. In the bar it shortens to "Dev" at phone width, still read in full. */
export function DevBadge({ shorten = false }: { shorten?: boolean }) {
  return <Badge>Dev{shorten ? <CompactHidden> mode</CompactHidden> : ' mode'}</Badge>
}

const Badge = styled.span`
  padding: ${space[1]} ${space[4]};
  border: 1px solid ${color.devLine};
  border-radius: ${radius.pill};
  background: ${color.devBg};
  color: ${color.devFg};
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  line-height: 1.4;
  white-space: nowrap;
`

const CompactHidden = styled.span`
  ${media.compact} {
    ${visuallyHidden}
  }
`
