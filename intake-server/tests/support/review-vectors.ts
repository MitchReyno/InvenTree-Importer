import type { CaptureSnapshotDto } from '@invimport/contracts'

const context = '60000000-0000-4000-8000-000000000006'
const partObservation = '70000000-0000-4000-8000-000000000007'
const locationObservation = '71000000-0000-4000-8000-000000000071'

export const VECTOR_PART = '20000000-0000-4000-8000-000000000002'
export const VECTOR_LOT_A = '30000000-0000-4000-8000-000000000003'
export const VECTOR_LOT_B = '31000000-0000-4000-8000-000000000031'

/** Fixed pre-T08 shape: two lots sharing one Part, an override and an inherited default. */
export const reviewVectorSnapshot: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '11000000-0000-4000-8000-000000000011',
  title: 'Frozen review vector',
  revision: '7',
  archived: false,
  updated_at: '2026-11-02T00:00:00.000Z',
  actor_id: '50000000-0000-4000-8000-000000000005',
  target_context_id: context,
  defaults: {
    quantity: { mode: 'unset' },
    location: {
      mode: 'set',
      value: {
        observation_id: locationObservation,
        target_context_id: context,
        model: 'location',
        pk: '43',
      },
    },
  },
  parts: [
    {
      id: VECTOR_PART,
      label: 'Shared resistor',
      revision: '2',
      choice: {
        mode: 'set',
        value: {
          observation_id: partObservation,
          target_context_id: context,
          model: 'part',
          pk: '29',
        },
      },
    },
  ],
  lots: [
    {
      id: VECTOR_LOT_A,
      label: 'Packet A',
      revision: '3',
      contribution_key: '40000000-0000-4000-8000-000000000004',
      part_subject_id: VECTOR_PART,
      quantity: { mode: 'set', value: '17.5' },
      location: { mode: 'inherit' },
    },
    {
      id: VECTOR_LOT_B,
      label: 'Packet B',
      revision: '3',
      contribution_key: '41000000-0000-4000-8000-000000000041',
      part_subject_id: VECTOR_PART,
      quantity: { mode: 'set', value: '23' },
      location: { mode: 'clear' },
    },
  ],
  notes: [
    {
      id: '80000000-0000-4000-8000-000000000008',
      subject_id: VECTOR_LOT_A,
      text: '17.5 counted',
      actor_id: '50000000-0000-4000-8000-000000000005',
      created_at: '2026-11-02T00:00:00.000Z',
      producer: 'human',
    },
    {
      id: '81000000-0000-4000-8000-000000000081',
      subject_id: VECTOR_LOT_B,
      text: '23 counted',
      actor_id: '50000000-0000-4000-8000-000000000005',
      created_at: '2026-11-02T00:00:00.000Z',
      producer: 'human',
    },
  ],
  observations: [
    {
      id: partObservation,
      model: 'part',
      pk: '29',
      target_context_id: context,
      label: 'Part 29',
      observed_at: '2026-11-02T00:00:00.000Z',
    },
    {
      id: locationObservation,
      model: 'location',
      pk: '43',
      target_context_id: context,
      label: 'Location 43',
      observed_at: '2026-11-02T00:00:00.000Z',
    },
  ],
  cursor: { stream_id: '90000000-0000-4000-8000-000000000009', sequence: '12' },
}

export const VECTOR_MEDIA_DIGESTS = new Map([
  [VECTOR_LOT_A, 'a'.repeat(64)],
  [VECTOR_PART, 'b'.repeat(64)],
])
