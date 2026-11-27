import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'

/** A small caps label, such as "Current values" over values a record holds now. */
export const DetailLabel = styled.span`
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  letter-spacing: ${typeVar.label.letterSpacing};
  text-transform: uppercase;
  color: ${color.muted};
`

export const Muted = styled.span`
  color: ${color.muted};
`

export const EntryCrop = styled.img`
  display: block;
  max-width: min(100%, 240px);
  max-height: 160px;
  object-fit: contain;
  border-radius: ${radius.thumb};
  background: ${color.surface2};
`

export const DetailList = styled.ul`
  display: grid;
  gap: ${space[2]};
  padding-left: ${space[5]};
`
