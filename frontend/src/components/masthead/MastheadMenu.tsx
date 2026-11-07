import { useId } from 'react'
import * as Popover from '@radix-ui/react-popover'
import styled, { keyframes } from 'styled-components'
import { color, radius, shadow, space, type } from '../../theme/generated/tokens'
import {
  THEME_CHOICES,
  useThemeChoice,
  type ThemeChoice,
  type ThemeController,
} from '../../theme/theme'
import { media } from '../ui/media'

const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' }

/** App-level links and the theme choice, kept out of the bar so it stays one row. */
export function MastheadMenu({ themeController }: { themeController?: ThemeController }) {
  const { choice, choose } = useThemeChoice(themeController)
  const themeId = useId()

  return (
    <Popover.Root modal={false}>
      <Popover.Trigger asChild>
        <Trigger type="button" aria-label="More">
          <span aria-hidden="true">⋯</span>
        </Trigger>
      </Popover.Trigger>
      <Popover.Portal>
        <Content align="end" sideOffset={8} collisionPadding={12} aria-label="Application options">
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
        </Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const open = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
`

const Trigger = styled.button`
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill};
  background: ${color.surface};
  color: ${color.fg};
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  &:hover,
  &[data-state='open'] {
    background: ${color.surface2};
  }
  ${media.compact} {
    width: 44px;
    height: 44px;
  }
`

const Content = styled(Popover.Content)`
  z-index: 1000;
  display: grid;
  gap: ${space[4]};
  width: 220px;
  padding: ${space[2]};
  border: 1px solid ${color.line};
  border-radius: ${radius.popover};
  background: ${color.surface};
  color: ${color.fg};
  box-shadow: ${shadow};
  animation: ${open} 120ms ease-out;
  ${media.reducedMotion} {
    animation: none;
  }
`

const Links = styled.nav`
  display: grid;
  a {
    padding: ${space[3]} ${space[4]};
    border-radius: ${radius.input};
    color: ${color.fg};
    text-decoration: none;
  }
  a:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    a {
      display: flex;
      align-items: center;
      min-height: 44px;
    }
  }
`

const Theme = styled.div`
  display: grid;
  gap: 2px;
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
    min-height: 44px;
  }
`
