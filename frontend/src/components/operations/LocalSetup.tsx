import styled from 'styled-components'
import type { useReadiness } from '#/debug/useReadiness'
import { Button, Paragraph, Small } from '#/components/ui'
import { color, space, typeVar } from '#/theme/generated/tokens'

type LocalSetupProps = {
  readiness: ReturnType<typeof useReadiness>
  /** The popover's short form: fewer rows and no description. */
  compact?: boolean
}

/** What the local server reports about its setup, with Check again. */
export function LocalSetup({ readiness, compact = false }: LocalSetupProps) {
  const failed = readiness.isError || readiness.fetchStatus === 'paused'

  return (
    <Stack>
      {!compact && (
        <Paragraph>
          Single-operator development mode. Account sign-in and complete permission checks are not
          yet available.
        </Paragraph>
      )}
      {failed ? (
        <Paragraph role="alert">
          Local setup checks are unavailable. Check the local server configuration and application
          version.
        </Paragraph>
      ) : readiness.data ? (
        <Facts>
          <dt>Saved state</dt>
          <dd>{compact ? 'Reachable' : 'Reachable · compatible application version'}</dd>
          <dt>Media</dt>
          <dd>{readiness.data.media === 'configured' ? 'Configured' : 'Disabled'}</dd>
          {!compact && (
            <>
              <dt>Inventory execution</dt>
              <dd>Supervised runner only</dd>
            </>
          )}
          <dt>Research</dt>
          <dd>{compact ? 'Unavailable' : 'Unavailable pending provider qualification'}</dd>
          {!compact && (
            <>
              <dt>Deployment</dt>
              <dd>Restricted local development</dd>
            </>
          )}
        </Facts>
      ) : (
        <Small role="status">Checking local setup…</Small>
      )}
      {!compact && (
        <span>
          <Button
            size="sm"
            disabled={readiness.isFetching}
            onClick={() => {
              void readiness.refetch()
            }}
          >
            Check again
          </Button>
        </span>
      )}
    </Stack>
  )
}

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[4]};
  min-width: 0;
`

const Facts = styled.dl`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  gap: ${space[2]} ${space[5]};
  margin: 0;
  font-size: ${typeVar.small.size};
  dt {
    color: ${color.muted};
  }
  dd {
    margin: 0;
  }
`
