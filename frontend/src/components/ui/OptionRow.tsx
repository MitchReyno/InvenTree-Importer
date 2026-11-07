import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '../../theme/generated/tokens'
import { media } from './media'

export type Option = { id: string; title: string; detail: string }

type OptionRowProps = {
  name: string
  /** Names the radio group when it isn't already inside a labelled fieldset. */
  legend?: string
  options: Option[]
  /** Always offered last, so the operator is never forced into a wrong answer. */
  escape: Option
  value: string | undefined
  onChange: (id: string) => void
}

export function OptionRow({ name, legend, options, escape, value, onChange }: OptionRowProps) {
  return (
    <Options role={legend ? 'radiogroup' : undefined} aria-label={legend}>
      {[...options, escape].map((option) => (
        <Choice key={option.id}>
          <input
            type="radio"
            name={name}
            value={option.id}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
          />
          <span>
            <strong>{option.title}</strong> <Detail>{option.detail}</Detail>
          </span>
        </Choice>
      ))}
    </Options>
  )
}

const Options = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[3]};
`

const Choice = styled.label`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: ${space[5]};
  padding: calc(${space[5]} - 1px) calc(${space[6]} - 1px);
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  background: ${color.surface};
  cursor: pointer;
  input {
    margin-top: 3px;
  }
  &:has(input:checked) {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const Detail = styled.span`
  display: block;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
