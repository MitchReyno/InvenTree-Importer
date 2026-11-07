import { useId } from 'react'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '../../theme/generated/tokens'

type Props = { label: string; explanation: string }

/** A disabled checkbox cannot take focus, so the focusable box carries the explanation instead. */
export function DisabledFeature({ label, explanation }: Props) {
  const id = useId()
  return (
    <Wrapper
      role="group"
      tabIndex={0}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-explanation`}
    >
      <label>
        <input type="checkbox" disabled tabIndex={-1} />
        <span id={`${id}-label`}>{label}</span>
      </label>
      <Soon>Coming later</Soon>
      <Explanation id={`${id}-explanation`}>{explanation}</Explanation>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: inline-flex;
  flex-direction: column;
  gap: ${space[2]};
  padding: ${space[5]} ${space[6]};
  border: 1px dashed ${color.lineStrong};
  border-radius: ${radius.card};
  color: ${color.muted};
  label {
    display: inline-flex;
    gap: ${space[4]};
    align-items: center;
    cursor: not-allowed;
  }
`

const Soon = styled.span`
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${color.info};
`

const Explanation = styled.span`
  font-size: ${typeVar.small.size};
`
