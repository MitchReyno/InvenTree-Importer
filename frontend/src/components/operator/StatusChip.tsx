import styled from 'styled-components'

export type ChipTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red'

const TONES: Record<ChipTone, { color: string; background: string; border: string }> = {
  neutral: { color: '#3c4b61', background: '#f1f4f8', border: '#d5dce5' },
  blue: { color: '#164a93', background: '#e0eafa', border: '#b9cde7' },
  green: { color: '#1e6a3a', background: '#e6f4ea', border: '#a9d4b5' },
  amber: { color: '#7a5410', background: '#fff4d9', border: '#e7d09c' },
  red: { color: '#9b2c2c', background: '#fff0f0', border: '#e3b0b0' },
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
