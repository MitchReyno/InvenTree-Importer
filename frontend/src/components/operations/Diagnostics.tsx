import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { intakeClient } from '@invimport/contracts/client'
import { serverQueryKey } from '#/queries/scope'
import { Paragraph, Small, Button } from '#/components/ui'
import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { useServerScope } from '#/context'

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
          <dd>Supervised runner only</dd>
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
  margin: ${space[3]} 0;
  padding: 0 ${space[5]} ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  font-size: ${typeVar.small.size};
  summary {
    cursor: pointer;
    min-height: ${size.touch};
    align-content: center;
  }
  dt {
    font-weight: ${typeVar.h3.weight};
  }
  dd {
    margin: ${space[2]} 0 ${space[5]};
  }
`
