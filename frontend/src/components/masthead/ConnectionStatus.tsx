import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { ConnectionStatusDto } from '@invimport/contracts'
import { color } from '#/theme/generated/tokens'
import { targetStatus } from '#/header/observations'
import { media, visuallyHidden } from '#/components/ui'
import { ConnectionDetails } from './ConnectionDetails'
import { ConnectionDot } from './ConnectionDot'
import { HeaderDisclosure } from './HeaderDisclosure'
import { type UpdateHealth } from '#/context'

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
          <ConnectionDot tone={status.tone} />
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
    </HeaderDisclosure>
  )
}

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
