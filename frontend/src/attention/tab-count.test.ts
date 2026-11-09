import type { BatchAttentionDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { stepStatus, tabCount, type TabCountInput } from './tab-count'

const none = { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 }

function attention(overrides: Partial<BatchAttentionDto> = {}): BatchAttentionDto {
  return {
    batch_id: 'b0000000-0000-4000-8000-000000000001',
    revision: '3',
    processing: {
      questions: 3,
      failed: 1,
      running: 2,
      steps: {
        examine: { ...none, questions: 1, jobs: 12, ready: 12 },
        research: { ...none, jobs: 12, ready: 7, running: 2 },
        images: { ...none, jobs: 12, ready: 9, running: 1 },
        inventory: { ...none, questions: 2, failed: 1, jobs: 12, ready: 1 },
      },
    },
    review: { to_check: 8, changed_after_review: 3, to_decide: 3, records: 46 },
    changes: { ready: 6, failed: 1, uncertain: 1, runs: 4 },
    items: [],
    items_truncated: false,
    ...overrides,
  }
}

const busy: TabCountInput = { attention: attention(), activeLotCount: 12, unusedFiles: 1 }

const quiet: TabCountInput = {
  attention: attention({
    processing: {
      questions: 0,
      failed: 2,
      running: 0,
      steps: {
        examine: { ...none, jobs: 12, ready: 12 },
        research: { ...none, failed: 2, jobs: 12, ready: 7 },
        images: none,
        inventory: none,
      },
    },
    review: { to_check: 0, changed_after_review: 0, to_decide: 0, records: 46 },
    changes: { ready: 0, failed: 0, uncertain: 0, runs: 4 },
  }),
  activeLotCount: 12,
  unusedFiles: 0,
}

/** "value tone" for each tab, or "none". */
function read(tab: Parameters<typeof tabCount>[0], input: TabCountInput) {
  const count = tabCount(tab, input)

  return count ? `${count.value} ${count.tone}` : 'none'
}

describe('tabCount follows the one-count table', () => {
  it.each([
    ['capture', 'none', 'none'],
    ['processing', '3 warn', 'none'],
    ['processing/overview', 'none', 'none'],
    ['processing/examine', '1 warn', 'none'],
    ['processing/research', '7/12 default', '7/12 default'],
    ['processing/images', '9/12 default', 'none'],
    ['processing/inventory', '2 warn', 'none'],
    ['review', '8 default', '0 default'],
    ['review/lots', '3 warn', '12 default'],
    ['review/map', '1 warn', 'none'],
    ['review/records', '3 warn', '46 default'],
    ['changes', '6 ok', '0 ok'],
    ['changes/ready', '6 ok', '0 ok'],
    ['changes/added', '2 bad', 'none'],
  ] as const)('%s reads %s with work to act on, else %s', (tab, withWork, without) => {
    expect(read(tab, busy)).toBe(withWork)
    expect(read(tab, quiet)).toBe(without)
  })

  it('names each count in words for its accessible name', () => {
    expect(tabCount('processing', busy)?.label).toBe('3 questions')
    expect(tabCount('processing/research', busy)?.label).toBe('7 of 12 ready')
    expect(tabCount('review', busy)?.label).toBe('8 to check')
    expect(tabCount('review/lots', busy)?.label).toBe('3 changed since review')
    expect(tabCount('review/lots', quiet)?.label).toBe('12 lots')
    expect(tabCount('review/map', busy)?.label).toBe('1 unused file')
    expect(tabCount('review/records', busy)?.label).toBe('3 to decide')
    expect(tabCount('review/records', quiet)?.label).toBe('46 records')
    expect(tabCount('changes', busy)?.label).toBe('6 ready to add')
    expect(tabCount('changes/added', busy)?.label).toBe('2 need attention')
  })

  it('shows no attention counts before the attention read, but still the lots it knows', () => {
    const unread: TabCountInput = { attention: undefined, activeLotCount: 12 }

    expect(read('processing', unread)).toBe('none')
    expect(read('review', unread)).toBe('none')
    expect(read('changes', unread)).toBe('none')
    expect(read('review/lots', unread)).toBe('12 default')
  })
})

describe('stepStatus', () => {
  it('spins while a step runs and ticks once every attempt is ready', () => {
    const read = attention()

    expect(stepStatus('examine', read)).toBe('done')
    expect(stepStatus('research', read)).toBe('running')
    expect(stepStatus('inventory', read)).toBeUndefined()
    expect(stepStatus('research', undefined)).toBeUndefined()
  })
})
