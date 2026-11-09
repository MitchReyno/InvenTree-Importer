import { useId } from 'react'
import styled from 'styled-components'
import { color, radius, size, space, type } from '#/theme/generated/tokens'
import {
  THEME_CHOICES,
  useThemeChoice,
  type ThemeChoice,
  type ThemeController,
} from '#/theme/theme'
import { media, hoverTransition, Popover } from '#/components/ui'

const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' }

/** App-level links and the theme choice, kept out of the bar so it stays one row. */
export function MastheadMenu({ themeController }: { themeController?: ThemeController }) {
  const { choice, choose } = useThemeChoice(themeController)
  const themeId = useId()

  return (
    <Popover
      label="Application options"
      width="220px"
      trigger={
        <Trigger type="button" aria-label="More">
          <span aria-hidden="true">⋯</span>
        </Trigger>
      }
    >
      <Body>
        <Links aria-label="Application">
          <a href="#agents">Agents</a>
          <a href="#settings">Agent settings</a>
        </Links>
        <Theme role="radiogroup" aria-labelledby={`${themeId}-label`}>
          <Label id={`${themeId}-label`}>Theme</Label>
          {THEME_CHOICES.map((option) => (
            <Choice key={option}>
              <input
                type="radio"
                name={themeId}
                value={option}
                checked={choice === option}
                onChange={() => choose(option)}
              />
              {THEME_LABEL[option]}
            </Choice>
          ))}
        </Theme>
      </Body>
    </Popover>
  )
}

const Trigger = styled.button`
  display: inline-grid;
  flex: none;
  place-items: center;
  width: ${size.control};
  height: ${size.control};
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  color: ${color.fg};
  /* literal-allowed: the ⋯ glyph reads as an icon at 16px; no icon token has that size */
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  &:hover,
  &[data-state='open'] {
    background: ${color.surface2};
  }
  ${media.compact} {
    width: ${size.touch};
    height: ${size.touch};
  }
`

const Body = styled.div`
  display: grid;
  gap: ${space[4]};
`

const Links = styled.nav`
  display: grid;
  a {
    padding: ${space[3]} ${space[4]};
    border-radius: ${radius.input};
    color: ${color.fg};
    text-decoration: none;
    ${hoverTransition}
  }
  a:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    a {
      display: flex;
      align-items: center;
      min-height: ${size.touch};
    }
  }
`

const Theme = styled.div`
  display: grid;
  gap: ${space[1]};
  padding: ${space[4]} ${space[4]} ${space[2]};
  border-top: 1px solid ${color.line};
`

const Label = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Choice = styled.label`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  min-height: 28px;
  cursor: pointer;
  ${media.compact} {
    min-height: ${size.touch};
  }
`
