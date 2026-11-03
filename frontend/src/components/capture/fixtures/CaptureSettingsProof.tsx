import { useState } from 'react'
import styled from 'styled-components'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { GlobalStyle } from '../../GlobalStyle'
import { CaptureWorkspace } from '../CaptureWorkspace'
import { Button } from '../../ui/primitives'

const lotId = '60000000-0000-4000-8000-000000000006'
const initial: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001', source_id: '20000000-0000-4000-8000-000000000002', actor_id: '30000000-0000-4000-8000-000000000003', target_context_id: '40000000-0000-4000-8000-000000000004',
  title: 'Synthetic bench receipts · separate packets', revision: '1', archived: false, updated_at: '2026-11-03T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  context: [{ id: '70000000-0000-4000-8000-000000000007', subject_id: null, version: '1', actor_id: '30000000-0000-4000-8000-000000000003', created_at: '2026-11-03T00:00:00Z', value: { supplier: { mode: 'unset' }, purchase_date: { mode: 'set', value: '2026-11-03' }, tags: { mode: 'set', value: ['bench', 'receipt', 'separate-physical-lots'] } } }],
  lots: [{ id: lotId, label: 'Packet A · opened bag', revision: '1', contribution_key: '80000000-0000-4000-8000-000000000008', part_subject_id: null, quantity: { mode: 'set', value: '12' }, location: { mode: 'inherit' } }],
  parts: [], observations: [],
  notes: [{ id: '90000000-0000-4000-8000-000000000009', subject_id: null, text: 'Synthetic receipt: keep the opened packet distinct from the unopened packet. Original count needs a human check.', actor_id: '30000000-0000-4000-8000-000000000003', producer: 'human', created_at: '2026-11-03T00:00:00Z' }],
  cursor: { stream_id: 'a0000000-0000-4000-8000-00000000000a', sequence: '0' },
}

export function CaptureSettingsProof() {
  const [right, setRight] = useState(false)
  const [batch, setBatch] = useState(initial)
  return <>
    <GlobalStyle />
    <Main $right={right}>
      <p>Owned synthetic layout fixture · no inventory requests or provider calls.</p>
      <Button onClick={() => setRight((value) => !value)}>Compare placement: {right ? 'right' : 'above'}</Button>
      <CaptureWorkspace batch={batch} busy={false} observe={async () => null} edit={async (change) => {
        if (change.kind === 'settings') {
          setBatch((previous) => ({ ...previous, title: change.title ?? previous.title }))
        }
      }} />
    </Main>
  </>
}

const Main = styled.main<{ $right: boolean }>`
  padding: 16px;
  max-width: 1600px;
  margin: auto;
  @media (min-width: 1001px) {
    [data-capture-grid] {
      grid-template-areas: ${(p) => p.$right ? "'queue context settings' 'editor editor settings'" : "'settings settings settings' 'queue context context'"};
      grid-template-columns: ${(p) => p.$right ? 'minmax(180px, .65fr) minmax(0, 1.4fr) minmax(300px, 1fr)' : 'minmax(200px, .7fr) minmax(0, 1.3fr) minmax(300px, 1fr)'};
    }
  }
`
