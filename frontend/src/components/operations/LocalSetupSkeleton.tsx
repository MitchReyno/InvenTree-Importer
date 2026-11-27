import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Skeleton } from '#/components/ui'

/** Local setup's facts in skeleton blocks, until the setup is read. */
export function LocalSetupSkeleton() {
  return (
    <Rows>
      {ROWS.map((row) => (
        <Skeleton key={row} width="60%" height={space[5]} />
      ))}
    </Rows>
  )
}

const ROWS = ['state', 'media', 'execution', 'web', 'deployment']

const Rows = styled.div`
  display: grid;
  gap: ${space[2]};
  width: 100%;
`
