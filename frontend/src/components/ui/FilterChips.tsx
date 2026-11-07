import styled from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { formatCount, media } from './media'
import { useRovingFocus } from './useRovingFocus'

export type FilterOption = { id: string; label: string; count: number }

type FilterChipsProps = {
  label: string
  options: FilterOption[]
  value: string
  onChange: (id: string) => void
}

/** Counts are always shown, zero included, so empty filters stay discoverable. */
export function FilterChips({ label, options, value, onChange }: FilterChipsProps) {
  const optionProps = useRovingFocus(
    options.map((option) => option.id),
    value,
  )

  return (
    <Group role="group" aria-label={label}>
      {options.map((option) => (
        <Chip
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          aria-label={`${option.label}, ${formatCount(option.count)}`}
          onClick={() => onChange(option.id)}
          {...optionProps(option.id)}
        >
          {option.label} <ChipCount>{formatCount(option.count)}</ChipCount>
        </Chip>
      ))}
    </Group>
  )
}

const Group = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`

const Chip = styled.button`
  padding: 3px ${space[5]};
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  font-size: 12.5px;
  cursor: pointer;
  &:hover {
    background: ${color.surface2};
  }
  &[aria-pressed='true'] {
    border-color: ${color.fg};
    background: ${color.fg};
    color: ${color.bg};
  }
  ${media.compact} {
    min-width: 44px;
    min-height: 44px;
  }
`

const ChipCount = styled.span`
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
`
