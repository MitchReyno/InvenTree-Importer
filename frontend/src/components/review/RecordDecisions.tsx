import type { BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { Banner } from '../ui/Banner'
import { NeedsYou } from '../ui/NeedsYou'

type RecordDecisionsProps = {
  batchId: string
  attention: BatchAttentionDto | undefined
  unavailable: boolean
}

/**
 * Review › Records before record-level editing exists: the decisions waiting in this batch,
 * each opening the lot where it is made today.
 */
export function RecordDecisions({ batchId, attention, unavailable }: RecordDecisionsProps) {
  const decisions = attention?.items.filter((item) => item.group === 'decision') ?? []
  const unlisted = (attention?.review.to_decide ?? 0) - decisions.length

  return (
    <Page>
      <Banner tone="info">
        Records will gather every InvenTree record this batch touches. For now, each decision opens
        its lot in <a href={batchHref(batchId, { tab: 'review', view: 'lots' })}>Lots</a>.
      </Banner>
      <Card aria-label="Decisions">
        <Title>Decisions</Title>
        {attention === undefined && unavailable && (
          <div role="alert">
            <Banner tone="bad">
              Decisions are unavailable. Each lot in Lots still shows its own.
            </Banner>
          </div>
        )}
        {attention === undefined && !unavailable && <Empty>Reading what needs a decision…</Empty>}
        {attention && (
          <NeedsYou
            items={decisions.map((item) => ({
              id: item.key,
              title: item.title,
              assumption: item.detail ?? '',
              href: `#${item.route}`,
            }))}
          />
        )}
        {unlisted > 0 && (
          <Empty>
            {unlisted} more {unlisted === 1 ? 'decision is' : 'decisions are'} not listed. Lots
            shows every lot&apos;s decisions.
          </Empty>
        )}
      </Card>
    </Page>
  )
}

const Page = styled.div`
  display: grid;
  gap: ${space[3]};
`

const Card = styled.section`
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Title = styled.h2`
  margin: 0;
  padding: ${space[3]} ${space[3]} ${space[1]};
  ${type.h2}
`

const Empty = styled.p`
  margin: 0;
  padding: ${space['2-5']} ${space[3]};
  color: ${color.muted};
`
