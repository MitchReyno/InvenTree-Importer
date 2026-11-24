import styled from 'styled-components'
import type { useReadiness } from '#/debug/useReadiness'
import { Button, Paragraph, ReadState, Spinner } from '#/components/ui'
import { LocalSetupSkeleton } from './LocalSetupSkeleton'
import { color, space, typeVar } from '#/theme/generated/tokens'

type LocalSetupProps = {
  readiness: ReturnType<typeof useReadiness>
  /** The popover's short form: fewer rows and no description. */
  compact?: boolean
}

/** Whether sessions can use the web, as the configured processing profile allows. */
function webAccessLabel(web: 'available' | 'unavailable', compact: boolean) {
  if (web === 'available') {
    return compact ? 'Available' : 'Available in VM sessions'
  }
  return compact ? 'Unavailable' : 'Unavailable for this profile'
}

/** What the local server reports about its setup, with Check again. */
export function LocalSetup({ readiness, compact = false }: LocalSetupProps) {
  const failed = readiness.phase === 'failed'

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
      ) : (
        <ReadState
          phase={readiness.phase}
          // The Dev mode menu is a debug read, so it waits with a spinner rather than a skeleton.
          skeleton={compact ? <Spinner /> : <LocalSetupSkeleton />}
        >
          {readiness.data && (
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
              <dt>Web access</dt>
              <dd>{webAccessLabel(readiness.data.web, compact)}</dd>
              {!compact && (
                <>
                  <dt>Deployment</dt>
                  <dd>Restricted local development</dd>
                </>
              )}
            </Facts>
          )}
        </ReadState>
      )}
      {!compact && (
        <span>
          <Button
            size="sm"
            disabled={readiness.query.isFetching}
            onClick={() => {
              void readiness.query.refetch()
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
  p {
    margin: 0;
  }
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
