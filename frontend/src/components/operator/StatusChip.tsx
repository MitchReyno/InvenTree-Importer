import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'

export type ChipTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red'

const TONES: Record<ChipTone, { color: string; background: string; border: string }> = {
  neutral: { color: color.fg, background: color.surface2, border: color.line },
  blue: { color: color.accent, background: color.accentWeak, border: color.accent },
  green: { color: color.ok, background: color.okWeak, border: color.ok },
  amber: { color: color.warn, background: color.warnWeak, border: color.warn },
  red: { color: color.bad, background: color.badWeak, border: color.bad },
}

/** Text carries the meaning; colour only reinforces it. */
export const StatusChip = styled.span<{ $tone: ChipTone }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
  border-radius: 999px;
  color: ${(p) => TONES[p.$tone].color};
  background: ${(p) => TONES[p.$tone].background};
  border: 1px solid ${(p) => TONES[p.$tone].border};
`
