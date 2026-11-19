import { useState } from 'react'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type { CaptureCreationNoticeDto } from '@invimport/contracts'
import { Banner, Button } from '#/components/ui'

const FIELD = { location: 'default location', supplier: 'default supplier' } as const

function sentence({ field, code }: CaptureCreationNoticeDto) {
  return code === 'default_not_found'
    ? `The ${FIELD[field]} saved in Settings wasn't found in InvenTree, so this batch started without it.`
    : `InvenTree couldn't be checked for the ${FIELD[field]} saved in Settings, so this batch started without it.`
}

/** Says which app-level defaults a new batch couldn't copy; dismissing hides it while Capture stays open. */
export function CreationNotices({ notices }: { notices: readonly CaptureCreationNoticeDto[] }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !notices.length) {
    return null
  }
  return (
    <Notice role="status">
      <Banner
        tone="info"
        action={
          <Button size="sm" onClick={() => setDismissed(true)}>
            Dismiss
          </Button>
        }
      >
        {notices.map(sentence).join(' ')} Set it in Batch settings if you need it.
      </Banner>
    </Notice>
  )
}

const Notice = styled.div`
  margin-bottom: ${space[8]};
`
