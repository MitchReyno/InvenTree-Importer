import { useState } from 'react'
import styled from 'styled-components'
import { color, radius, size, space, type, typeVar } from '#/theme/generated/tokens'
import { Button, Popover, Switch, media, visuallyHidden } from '#/components/ui'
import { DevToolActions } from '#/components/operations/DevToolActions'
import { LocalSetup } from '#/components/operations/LocalSetup'
import { useDebugMode } from '#/debug/debug-mode'
import { useReadiness } from '#/debug/useReadiness'

const POPOVER_WIDTH = '340px'

/**
 * The Dev mode pill in the bar: a button opening developer tools. At phone width it shortens to
 * "Dev", still read in full.
 */
export function DevModeButton() {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      label="Developer tools"
      open={open}
      onOpenChange={setOpen}
      align="start"
      width={POPOVER_WIDTH}
      trigger={
        <Pill type="button" aria-label="Dev mode: open developer tools">
          Dev<CompactHidden> mode</CompactHidden>
        </Pill>
      }
    >
      <DevTools onNavigate={() => setOpen(false)} />
    </Popover>
  )
}

/** Mounted only while the popover is open, so local setup is read only then. */
function DevTools({ onNavigate }: { onNavigate: () => void }) {
  const { enabled, setEnabled } = useDebugMode()
  const readiness = useReadiness(true)
  const failed = readiness.isError || readiness.fetchStatus === 'paused'

  return (
    <Panel>
      <Section>
        <strong>Development build</strong>
        <Note>Single operator, local server. Approvals write only to the test InvenTree.</Note>
      </Section>
      <Section>
        <Switch label="Debug mode" checked={enabled} onChange={setEnabled} />
        <Note>Shows IDs, revisions and raw states on every screen. Saved on this device.</Note>
      </Section>
      <Section>
        <Label>Local setup</Label>
        <LocalSetup readiness={readiness} compact />
      </Section>
      <Section>
        <Button
          variant="ghost"
          size="sm"
          disabled={readiness.isFetching}
          onClick={() => {
            void readiness.refetch()
          }}
        >
          Check setup again
        </Button>
        <DevToolActions readiness={failed ? 'unavailable' : readiness.data} layout="column" />
        <Button as="a" variant="ghost" size="sm" href="#settings/developer" onClick={onNavigate}>
          Developer settings
        </Button>
      </Section>
    </Panel>
  )
}

const Pill = styled.button`
  position: relative;
  padding: ${space[1]} ${space[4]};
  border: 1px solid ${color.devLine};
  border-radius: ${radius.pill};
  background: ${color.devBg};
  color: ${color.devFg};
  font: inherit;
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  /* The pill stays small; its hit area reaches the touch target. */
  &::after {
    content: '';
    position: absolute;
    inset: 50% auto auto 50%;
    width: max(100%, ${size.touch});
    height: max(100%, ${size.touch});
    transform: translate(-50%, -50%);
  }
`

const CompactHidden = styled.span`
  ${media.compact} {
    ${visuallyHidden}
  }
`

const Panel = styled.div`
  display: flex;
  flex-direction: column;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[3]};
  padding: ${space[4]} ${space[5]};
  border-top: 1px solid ${color.line};
  &:first-child {
    border-top: 0;
  }
`

const Note = styled.span`
  color: ${color.muted};
  ${type.small}
`

const Label = styled.span`
  color: ${color.muted};
  ${type.label}
`
