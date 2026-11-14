import { useState } from 'react'
import styled from 'styled-components'
import { GlobalStyle } from '#/components/GlobalStyle'
import { Masthead } from '#/components/masthead/Masthead'
import { HeaderDisclosure } from '#/components/masthead/HeaderDisclosure'

/** Owned browser fixture: no API clients, target observations or provider calls. */
export function HeaderDisclosureProof() {
  const [open, setOpen] = useState<'connection' | 'workflow' | null>(null)

  function changeOpen(panel: 'connection' | 'workflow', next: boolean) {
    setOpen((current) => {
      if (next) {
        return panel
      }
      return current === panel ? null : current
    })
  }

  return (
    <>
      <GlobalStyle />
      <Masthead
        status={
          <Actions>
            <HeaderDisclosure
              label="Connection status"
              title="Connection details"
              trigger="Connection"
              variant="connection"
              open={open === 'connection'}
              onOpenChange={(next) => changeOpen('connection', next)}
            >
              <p>Fixture target: unknown. No connection check is performed.</p>
              <p>Application API: fixture only.</p>
              <p>Live updates: fixture only.</p>
            </HeaderDisclosure>
            <HeaderDisclosure
              label="Workflow activity"
              title="Workflow details"
              trigger="Workflow"
              variant="activity"
              open={open === 'workflow'}
              onOpenChange={(next) => changeOpen('workflow', next)}
            >
              <p>Fixture work status: idle.</p>
              <p>There are no actual agent sessions in this fixture.</p>
            </HeaderDisclosure>
          </Actions>
        }
      />
      <Main>
        <h1>Header disclosure qualification fixture</h1>
        <label>
          Fixture draft
          <input aria-label="Fixture draft" defaultValue="" />
        </label>
        <p>
          Only the disclosure mechanics are under test. No status is inferred from this fixture.
        </p>
      </Main>
    </>
  )
}

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  position: relative;
`
const Main = styled.main`
  padding: 16px;
  max-width: 100%;
  input {
    max-width: 100%;
  }
`
