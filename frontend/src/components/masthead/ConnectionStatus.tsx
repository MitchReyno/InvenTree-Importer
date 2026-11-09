import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { ConnectionStatusDto } from '@invimport/contracts'
import { color, radius, space } from '#/theme/generated/tokens'
import { targetStatus } from '#/header/observations'
import type { UpdateHealth } from '#/components/operations/LiveUpdates'
import { media, visuallyHidden } from '#/components/ui'
import { ConnectionDetails } from './ConnectionDetails'
import { HeaderDisclosure } from './HeaderDisclosure'
import { ThemeChoice } from './ThemeChoice'

interface Props {
  target?: ConnectionStatusDto['target']
  unavailable: boolean
  apiChecked: number
  now: number
  health: UpdateHealth
  /** The Open InvenTree link, or the reason there is none. */
  inventree: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The InvenTree target pill, a toned dot beside its name, opening the server menu. */
export function ConnectionStatus({
  target,
  unavailable,
  apiChecked,
  now,
  health,
  inventree,
  open,
  onOpenChange,
}: Props) {
  const status = targetStatus(target, unavailable, now)

  return (
    <HeaderDisclosure
      label="Connection status"
      title="Connection details"
      variant="connection"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <>
          <Dot data-tone={status.tone} />
          <Text
            role="status"
            aria-live="polite"
            data-compact="visually-hidden"
            title={status.summary}
          >
            {status.summary}
          </Text>
          <ShortText aria-hidden="true" data-short={status.short} />
          <Caret aria-hidden="true">▾</Caret>
        </>
      }
    >
      <ConnectionDetails
        target={target}
        apiUnavailable={unavailable}
        apiChecked={apiChecked}
        now={now}
        health={health}
        inventree={inventree}
      />
      {/* Until Settings › Appearance exists, the theme choice lives here. */}
      <ThemeSection>
        <ThemeChoice />
      </ThemeSection>
    </HeaderDisclosure>
  )
}

const dotTone = {
  ok: color.ok,
  info: color.info,
  warn: color.warn,
  bad: color.bad,
  muted: color.muted,
}

const Dot = styled.span<{ 'data-tone': keyof typeof dotTone }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: ${radius.round};
  background: ${(props) => dotTone[props['data-tone']]};
`

const Text = styled.span`
  min-width: 0;
  max-width: 28ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  ${media.compact} {
    ${visuallyHidden}
  }
`

const ShortText = styled.span`
  display: none;
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &::before {
    content: attr(data-short);
  }
  ${media.compact} {
    display: inline;
  }
`

const Caret = styled.span`
  color: ${color.muted};
`

const ThemeSection = styled.div`
  padding: ${space[4]} ${space[5]} ${space[5]};
  border-top: 1px solid ${color.line};
`
