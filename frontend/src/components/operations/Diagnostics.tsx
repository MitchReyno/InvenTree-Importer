import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { intakeClient } from '@invimport/contracts/client'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { Button, Paragraph, Small } from '../ui/primitives'
import styled from 'styled-components'

export function Diagnostics() {
  const scope = useServerScope()
  const client = useMemo(() => intakeClient(scope.origin), [scope.origin])
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'readiness'),
    queryFn: () => client.readiness(),
    enabled: open,
  })
  return (
    <Container onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Local setup and diagnostics</summary>
      <Paragraph>
        Single-operator development mode. Account sign-in and complete permission checks are not yet
        available.
      </Paragraph>
      {query.isError ? (
        <Paragraph role="alert">
          Saved-state checks are unavailable. Check the local server configuration and application
          version.
        </Paragraph>
      ) : query.data ? (
        <dl>
          <dt>Saved state</dt>
          <dd>Reachable · compatible application version</dd>
          <dt>Media</dt>
          <dd>{query.data.media === 'configured' ? 'Configured' : 'Disabled'}</dd>
          <dt>Inventory execution</dt>
          <dd>Separately supervised owned fake only</dd>
          <dt>Research</dt>
          <dd>Unavailable pending provider qualification</dd>
          <dt>Deployment</dt>
          <dd>Restricted local development</dd>
        </dl>
      ) : (
        <Small>Checking local setup…</Small>
      )}
      <Button
        disabled={query.isFetching}
        onClick={() => {
          void query.refetch()
        }}
      >
        Check again
      </Button>
    </Container>
  )
}

const Container = styled.details`
  margin: 6px 0;
  padding: 0 10px 8px;
  border: 1px solid #d5dce5;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  summary {
    cursor: pointer;
    min-height: 44px;
    align-content: center;
  }
  dt {
    font-weight: 650;
  }
  dd {
    margin: 4px 0 10px;
  }
`
