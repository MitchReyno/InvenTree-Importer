import { useId } from 'react'
import styled from 'styled-components'
import { media } from '#/components/ui'
import { color, size, space, typeVar } from '#/theme/generated/tokens'
import { MASTHEAD_STYLES, useMastheadStyle, type MastheadStyle } from '#/theme/masthead-style'

const OPTIONS: Record<MastheadStyle, { label: string; description: string }> = {
  bar: { label: 'In the bar', description: 'The masthead only.' },
  window: { label: 'Behind the whole window', description: 'Dotted ground under every page.' },
  fade: { label: 'Fading down', description: 'A band at the top that fades out.' },
}

type MastheadChoiceProps = {
  /** Names the group by its setting row's label. */
  labelledBy: string
}

/** Where the electronics current lives, stored as the app's masthead preference. */
export function MastheadChoice({ labelledBy }: MastheadChoiceProps) {
  const { style, choose } = useMastheadStyle()
  const groupId = useId()

  return (
    <Group role="radiogroup" aria-labelledby={labelledBy}>
      {MASTHEAD_STYLES.map((option) => {
        const labelId = `${groupId}-${option}-label`
        const descriptionId = `${groupId}-${option}-description`

        return (
          <Option key={option}>
            <input
              type="radio"
              name={groupId}
              value={option}
              checked={style === option}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              onChange={() => choose(option)}
            />
            <Text>
              <Name id={labelId}>{OPTIONS[option].label}</Name>
              <Description id={descriptionId}>{OPTIONS[option].description}</Description>
            </Text>
          </Option>
        )
      })}
    </Group>
  )
}

const Group = styled.div`
  display: grid;
  gap: ${space[4]};
`

const Option = styled.label`
  display: flex;
  align-items: flex-start;
  gap: ${space[4]};
  min-height: 28px;
  cursor: pointer;
  ${media.compact} {
    min-height: ${size.touch};
  }
  input {
    margin-top: ${space[1]};
  }
`

const Text = styled.span`
  display: grid;
  gap: ${space[1]};
`

const Name = styled.span`
  font-weight: ${typeVar.bodyStrong.weight};
`

const Description = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
