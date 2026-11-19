import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'

/** The development build's static badge, inside the server menu; the bar uses `DevModeButton`. */
export function DevBadge() {
  return <Badge>Dev mode</Badge>
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
