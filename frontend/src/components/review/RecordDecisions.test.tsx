import { render, screen } from '@testing-library/react'
import type { BatchAttentionDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { RecordDecisions } from './RecordDecisions'

const b = 'b0000000-0000-4000-8000-000000000001'
const none = { questions: 0, failed: 0 }

function attention(decisions: number, toDecide: number, truncated: boolean): BatchAttentionDto {
  return {
    batch_id: b,
    revision: '1',
    processing: {
      questions: 0,
      failed: 0,
      steps: { examine: none, research: none, images: none, inventory: none },
    },
    review: { to_check: 0, changed_after_review: 0, to_decide: toDecide },
    changes: { ready: 0, failed: 0, uncertain: 0 },
    items: Array.from({ length: decisions }, (_, n) => ({
      key: `decision:${n}`,
      group: 'decision' as const,
      tab: 'review' as const,
      title: `Decision ${n}`,
      detail: null,
      route: `${b}/review/lots`,
    })),
    items_truncated: truncated,
  }
}

describe('RecordDecisions', () => {
  it('says how many decisions are not listed when the read was cut short', () => {
    render(<RecordDecisions batchId={b} attention={attention(2, 5, true)} unavailable={false} />)

    expect(screen.getAllByRole('link', { name: /^Decision/ })).toHaveLength(2)
    expect(screen.getByText(/3 more decisions are not listed/)).toBeInTheDocument()
  })

  it('says the decisions are unavailable when the read fails', () => {
    render(<RecordDecisions batchId={b} attention={undefined} unavailable />)

    expect(screen.getByRole('alert')).toHaveTextContent('Decisions are unavailable')
    expect(screen.queryByText(/Reading what needs a decision/)).not.toBeInTheDocument()
  })
})
