import styled from 'styled-components'
import { color, space, type } from '#/theme/generated/tokens'
import { Button, Switch } from '#/components/ui'
import { DevToolActions } from '#/components/operations/DevToolActions'
import { LocalSetup } from '#/components/operations/LocalSetup'
import { useDebugMode } from '#/debug/debug-mode'
import { useReadiness } from '#/debug/useReadiness'

/** Mounted only while the popover is open, so local setup is read only then. */
export function DevTools({ onNavigate }: { onNavigate: () => void }) {
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
