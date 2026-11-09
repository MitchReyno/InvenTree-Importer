import { useId } from 'react'
import styled from 'styled-components'
import { color, size, space, type } from '#/theme/generated/tokens'
import { THEME_CHOICES, useThemeChoice, type ThemeChoice as Choice } from '#/theme/theme'
import { media } from '#/components/ui'

const THEME_LABEL: Record<Choice, string> = { light: 'Light', dark: 'Dark', system: 'System' }

/** Light, Dark or System, stored as the app's theme preference. */
export function ThemeChoice() {
  const { choice, choose } = useThemeChoice()
  const themeId = useId()

  return (
    <Theme role="radiogroup" aria-labelledby={`${themeId}-label`}>
      <Label id={`${themeId}-label`}>Theme</Label>
      {THEME_CHOICES.map((option) => (
        <Option key={option}>
          <input
            type="radio"
            name={themeId}
            value={option}
            checked={choice === option}
            onChange={() => choose(option)}
          />
          {THEME_LABEL[option]}
        </Option>
      ))}
    </Theme>
  )
}

const Theme = styled.div`
  display: grid;
  gap: ${space[1]};
`

const Label = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Option = styled.label`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  min-height: 28px;
  cursor: pointer;
  ${media.compact} {
    min-height: ${size.touch};
  }
`
