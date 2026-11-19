import { useState } from 'react'
import styled from 'styled-components'
import { useQueryClient } from '@tanstack/react-query'
import type { ReadinessDto } from '@invimport/contracts'
import { Button, Small } from '#/components/ui'
import { useUpdateHealth } from '#/context'
import { debugInfoText } from '#/debug/debug-info'
import { space } from '#/theme/generated/tokens'

type DevToolActionsProps = {
  /** The readiness the summary reports: its data, `unavailable`, or undefined before a read. */
  readiness: ReadinessDto | 'unavailable' | undefined
  /** Lays the buttons out as a column of menu-like rows in the popover. */
  layout?: 'row' | 'column'
}

/** Reload app data and Copy debug info, shared by Settings › Developer and the Dev mode popover. */
export function DevToolActions({ readiness, layout = 'row' }: DevToolActionsProps) {
  const queryClient = useQueryClient()
  const health = useUpdateHealth()
  const [message, setMessage] = useState('')

  function reloadAppData() {
    // Server reads refetch; form drafts and the navigation guard live outside the cache.
    void queryClient.invalidateQueries()
    setMessage('Reading everything again from the server.')
  }

  async function copyDebugInfo() {
    const text = debugInfoText({
      route: window.location.hash.replace(/^#/, ''),
      readiness,
      health,
      now: Date.now(),
    })

    try {
      await navigator.clipboard.writeText(text)
      setMessage('Debug info copied.')
    } catch {
      setMessage("Couldn't copy: the browser refused clipboard access.")
    }
  }

  return (
    <Stack>
      <Buttons $layout={layout}>
        <Button variant="ghost" size="sm" onClick={reloadAppData}>
          Reload app data
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void copyDebugInfo()}>
          Copy debug info
        </Button>
      </Buttons>
      <Small role="status">{message}</Small>
    </Stack>
  )
}

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[2]};
`

const Buttons = styled.div<{ $layout: 'row' | 'column' }>`
  display: flex;
  flex-direction: ${({ $layout }) => $layout};
  flex-wrap: wrap;
  align-items: ${({ $layout }) => ($layout === 'column' ? 'stretch' : 'center')};
  gap: ${space[3]};
`
