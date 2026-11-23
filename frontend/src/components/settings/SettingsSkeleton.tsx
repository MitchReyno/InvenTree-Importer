import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import { Skeleton } from '#/components/ui'
import { SettingsCard } from './SettingsCard'

/** A settings card's rows in skeleton blocks, until the saved settings are read. */
export function SettingsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <SettingsCard as="div" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Row key={index}>
          <Skeleton width="35%" height={space[6]} />
          <Skeleton width="20%" height={space[8]} />
        </Row>
      ))}
    </SettingsCard>
  )
}

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[6]};
  padding: ${space[8]};
`
