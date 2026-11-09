import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, icon, radius, size, space, type, typeVar } from '#/theme/generated/tokens'
import type { TargetStatus } from '#/header/observations'
import { hoverTransition, MenuIcon, Popover, VisuallyHidden } from '#/components/ui'
import { ConnectionDot } from './ConnectionDot'
import { ThemeChoice } from '#/components/settings/ThemeChoice'

type PhoneMenuProps = {
  /** The connection state the button's dot and name carry. */
  status: TargetStatus
  /** The server details, Open InvenTree among them. */
  server: ReactNode
  /** Announce connection changes; false on a second copy, so a change is read once. */
  announce: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The phone bar's menu: Agents, Settings, the server and the theme, behind one button. */
export function PhoneMenu({ status, server, announce, open, onOpenChange }: PhoneMenuProps) {
  return (
    <>
      {announce && (
        <VisuallyHidden role="status" aria-live="polite">
          {status.summary}
        </VisuallyHidden>
      )}
      <Popover
        label="Menu"
        width={`min(360px, calc(100vw - ${space[8]}))`}
        open={open}
        onOpenChange={onOpenChange}
        trigger={
          <Trigger type="button" aria-label={`Menu, ${status.summary}`} data-focus-key="menu">
            <MenuIcon />
            <DotSlot>
              <ConnectionDot tone={status.tone} />
            </DotSlot>
          </Trigger>
        }
      >
        <Links aria-label="Application">
          <a href="#agents">Agents</a>
          <a href="#settings">Settings</a>
        </Links>
        <Section>
          <Label>Server</Label>
          <Summary>
            <ConnectionDot tone={status.tone} />
            {status.summary}
          </Summary>
          {server}
        </Section>
        <Section>
          <ThemeChoice />
        </Section>
      </Popover>
    </>
  )
}

const Trigger = styled.button`
  position: relative;
  display: inline-grid;
  flex: none;
  place-items: center;
  width: ${size.touch};
  height: ${size.touch};
  padding: 0;
  border: 0;
  border-radius: ${radius.btn};
  background: transparent;
  color: ${color.fg};
  cursor: pointer;
  ${hoverTransition}
  &:hover,
  &[data-state='open'] {
    background: ${color.surface2};
  }
  svg {
    display: block;
    width: ${icon.md};
    height: ${icon.md};
  }
`

/** The connection dot sits on the icon's top-right corner, ringed so it reads on any ground. */
const DotSlot = styled.span`
  position: absolute;
  top: ${space[4]};
  right: ${space[4]};
  display: inline-flex;
  padding: ${space[1]};
  border-radius: ${radius.round};
  background: ${color.mastheadGround};
`

const Links = styled.nav`
  display: grid;
  border-bottom: 1px solid ${color.line};
  a {
    display: flex;
    align-items: center;
    min-height: ${size.touch};
    padding: 0 ${space[5]};
    border-radius: ${radius.input};
    color: ${color.fg};
    font-weight: ${typeVar.bodyStrong.weight};
    text-decoration: none;
    ${hoverTransition}
  }
  a:hover {
    background: ${color.surface2};
  }
`

const Section = styled.section`
  display: grid;
  gap: ${space[2]};
  padding: ${space[4]} ${space[5]};
  & + & {
    border-top: 1px solid ${color.line};
  }
`

const Label = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Summary = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
  font-size: ${typeVar.small.size};
`
