import { Button, PageTitle, Panel, Paragraph, Notice } from './components/ui/primitives'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { captureClient, intakeClient, manualClient } from '@invimport/contracts/client'
import type { BootstrapDto } from '@invimport/contracts'
import { Batches } from './components/batches/Batches'
import { Batch } from './components/batches/Batch'
import { GlobalStyle } from './components/GlobalStyle'
import styled from 'styled-components'
import { ActivityIndicator } from './components/ui/ActivityIndicator'
import { useNavigationGuard } from './navigation/useNavigationGuard'

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapDto | null>(null)
  const [error, setError] = useState('')
  const { route, navigationBlocked, onDirtyChange } = useNavigationGuard()
  useEffect(() => {
    let active = true
    void intakeClient(location.origin)
      .bootstrap()
      .then((value) => {
        if (active) {
          setBootstrap(value)
        }
      })
      .catch(() => {
        if (active) {
          setError('Application unavailable. Check the local API and retry.')
        }
      })
    return () => {
      active = false
    }
  }, [])
  const client = useMemo(
    () => (bootstrap?.csrf_token ? captureClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap],
  )
  const manual = useMemo(
    () => (bootstrap?.csrf_token ? manualClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap],
  )
  let content: ReactNode
  if (error) {
    content = (
      <div role="alert">
        {error} <Button onClick={() => location.reload()}>Retry connection</Button>
      </div>
    )
  } else if (!bootstrap) {
    content = <Paragraph role="status">Loading…</Paragraph>
  } else if (!client) {
    content = (
      <Panel>
        <PageTitle>Local setup required</PageTitle>
        <Paragraph>
          Configure the server-side development key reference and capture database. No browser
          credential entry is supported.
        </Paragraph>
        <Paragraph>
          Final identity and complete permission qualification are deferred to T11.
        </Paragraph>
      </Panel>
    )
  } else if (route && manual) {
    content = (
      <Batch
        key={route.split('/')[0]}
        id={route.split('/')[0]}
        client={client}
        manual={manual}
        route={route}
        onDirtyChange={onDirtyChange}
      />
    )
  } else {
    content = <Batches client={client} onDirtyChange={onDirtyChange} />
  }
  return (
    <AppShell>
      <GlobalStyle />
      <Masthead>
        <Brand>
          Bench <span>Intake</span>
        </Brand>
        <span>Manual workflow</span>
      </Masthead>
      <DevelopmentBanner>
        {bootstrap?.banner ?? 'Connecting to local application…'}
      </DevelopmentBanner>
      {manual && <ActivityIndicator client={manual} />}
      {navigationBlocked && (
        <Notice role="alert">
          Your unsaved input is preserved. Save this form or discard its unsaved input before
          navigating, then choose the destination again.
        </Notice>
      )}
      <Main>{content}</Main>
      <Footer>
        Saved in the application database, not this browser. Exact manual approvals can queue the
        separately supervised owned fake. Real inventory writes, uploads and research remain
        unavailable.
      </Footer>
    </AppShell>
  )
}

const AppShell = styled.div`
  max-width: 1600px;
  padding: 0 24px;
  margin: auto;
  @media (max-width: 700px) {
    padding: 0 12px;
  }
`
const Masthead = styled.header`
  min-height: 60px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid #d5dce5;
  @media (max-width: 700px) {
    min-height: 56px;
    font-size: 12px;
  }
`
const Brand = styled.strong`
  font-size: 22px;
  font-weight: 750;
  text-decoration: none;
  color: #233349;
  span {
    font-weight: 450;
  }
  @media (max-width: 700px) {
    font-size: 20px;
  }
`
const DevelopmentBanner = styled.p`
  padding: 8px 12px;
  color: #644813;
  background: #fff3d8;
  border: 1px solid #e7d09c;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
`
const Main = styled.main`
  margin: 18px auto;
`
const Footer = styled.footer`
  padding: 24px 0;
  border-top: 1px solid #d5dce5;
  font-size: 12px;
  color: #526179;
  line-height: 1.6;
`
