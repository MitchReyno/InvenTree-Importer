import styled from 'styled-components'
import { color, font, radius, space, type, typeVar } from '#/theme/generated/tokens'

/** One part of the brief, below a rule, with its heading. */
export const BriefSection = styled.section`
  display: grid;
  gap: ${space[2]};
  padding: ${space[3]} ${space[4]};
  border-top: 1px solid ${color.line};
  min-width: 0;
`

export const BriefHeading = styled.h3`
  margin: 0;
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  letter-spacing: ${typeVar.label.letterSpacing};
  text-transform: uppercase;
  color: ${color.muted};
`

export const BriefRows = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[2]};
  min-width: 0;
`

/** A row's text beside its time or state, which wraps below it when narrow. */
export const BriefRow = styled.li`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space[1]} ${space[3]};
  min-width: 0;
  overflow-wrap: anywhere;
  > :first-child {
    flex: 1 1 16rem;
    min-width: 0;
  }
`

export const Reading = styled.span`
  font-family: ${font.mono};
`

/** A reading the operator corrected away, kept visible but struck through. */
export const Was = styled.del`
  color: ${color.muted};
`

/** Marks what is the operator's own: a correction, an answer, a note. */
export const Yours = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[1]};
  padding: 0 ${space[2]};
  border: 1px solid ${color.accent};
  border-radius: ${radius.sm};
  color: ${color.accent};
  ${type.pill}
`

export const BriefMuted = styled.span`
  color: ${color.muted};
  ${type.small}
`
