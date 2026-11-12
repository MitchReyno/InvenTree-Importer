import { useRef, useState } from 'react'
import type { CaptureSnapshotDto, MediaSnapshotDto, MediaEditDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { GlobalStyle } from '#/components/GlobalStyle'
import { CaptureWorkspace } from '#/components/capture/CaptureWorkspace'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import type { MediaClient } from '#/media/types'
import { EvidenceViewer } from '#/components/operator/EvidenceViewer'
import { Main, PageContent } from '#/components/AppLayout'
import { ApiClientsProvider, BatchCommandsProvider } from '#/context'
import { batchCommands } from '#/test/batch-commands'

const actor = '30000000-0000-4000-8000-000000000003'
const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: actor,
  target_context_id: '40000000-0000-4000-8000-000000000004',
  title: 'Bench receipt · distinct physical packets',
  revision: '1',
  archived: false,
  updated_at: '2026-11-03T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  parts: [],
  lots: [1, 2].map((n) => ({
    id: `50000000-0000-4000-8000-00000000000${n}`,
    label: `Packet ${n === 1 ? 'A · opened' : 'B · sealed'}`,
    revision: '1',
    contribution_key: `60000000-0000-4000-8000-00000000000${n}`,
    part_subject_id: null,
    quantity: n === 1 ? { mode: 'unknown' } : { mode: 'set', value: '10' },
    location: { mode: 'inherit' },
  })),
  notes: [],
  observations: [],
  cursor: { stream_id: '70000000-0000-4000-8000-000000000007', sequence: '0' },
}
const groupA = '80000000-0000-4000-8000-000000000008'
const groupB = '90000000-0000-4000-8000-000000000009'
const initial: MediaSnapshotDto = {
  batch_id: batch.id,
  revision: '1',
  groups: [
    { id: groupA, label: 'Opened packet · front and back' },
    { id: groupB, label: 'Sealed packet · separate lot' },
  ],
  evidence: ['Front label', 'Back marking'].map((label, index) => ({
    id: `a0000000-0000-4000-8000-00000000000${index + 1}`,
    label,
    group_id: groupA,
    linked_subject_ids: [batch.lots[0].id],
    versions: [],
  })),
  attachments: [],
  derivations: [],
}

export function GroupedCaptureProof() {
  const retained = useRef(initial)
  const [snapshot, setSnapshot] = useState(initial)
  const [reject, setReject] = useState(false)
  const [calls, setCalls] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [review, setReview] = useState(false)

  function edit(input: MediaEditDto) {
    setCalls((value) => value + 1)
    if (reject || input.expected_revision !== retained.current.revision) {
      throw new IntakeRequestError(412, 'revision_conflict')
    }
    const change = input.change
    let value = retained.current
    if (change.kind === 'move_many') {
      value = {
        ...value,
        evidence: value.evidence.map((item) =>
          change.evidence_ids.includes(item.id) ? { ...item, group_id: change.group_id } : item,
        ),
      }
    }
    if (change.kind === 'group') {
      value = {
        ...value,
        groups: [...value.groups, { id: crypto.randomUUID(), label: change.label }],
      }
    }
    if (change.kind === 'rename_group') {
      value = {
        ...value,
        groups: value.groups.map((group) =>
          group.id === change.group_id ? { ...group, label: change.label } : group,
        ),
      }
    }
    if (change.kind === 'ungroup') {
      value = {
        ...value,
        groups: value.groups.filter((group) => group.id !== change.group_id),
        evidence: value.evidence.map((item) =>
          item.group_id === change.group_id ? { ...item, group_id: null } : item,
        ),
      }
    }
    if (change.kind === 'evidence_note') {
      value = {
        ...value,
        evidence: value.evidence.map((item) =>
          item.id === change.evidence_id
            ? {
                ...item,
                note: {
                  id: crypto.randomUUID(),
                  version: '1',
                  text: change.text,
                  actor_id: actor,
                  created_at: batch.updated_at,
                },
              }
            : item,
        ),
      }
    }
    value = { ...value, revision: String(Number(value.revision) + 1) }
    retained.current = value
    setSnapshot(value)
    return value
  }

  const media: MediaClient = {
    snapshot: async () => retained.current,
    edit: async (_id, input) => edit(input),
    upload: async () => {
      throw new Error(
        'Fixture upload intentionally unavailable; use boundary tests for byte receipts.',
      )
    },
  }
  return (
    <ServerStateProvider
      scope={{
        origin: location.origin,
        actorId: actor,
        targetId: 'b0000000-0000-4000-8000-00000000000b',
        targetContextId: batch.target_context_id,
      }}
    >
      <GlobalStyle />
      <PageContent $width="content">
        <Main>
          <h1>Grouped Capture qualification</h1>
          <p>Owned synthetic client · no inventory/provider traffic · files awaiting preview.</p>
          <label>
            <input
              type="checkbox"
              checked={reject}
              onChange={(event) => setReject(event.target.checked)}
            />
            Refuse membership for conflict qualification
          </label>
          <p role="status">
            Media commands: {calls} · Navigation protected: {dirty ? 'yes' : 'no'}
          </p>
          <button disabled={dirty} onClick={() => setReview(!review)}>
            {review ? 'Back to Capture' : 'Inspect retained Review context'}
          </button>
          {review ? (
            <EvidenceViewer
              batchId={batch.id}
              evidence={snapshot.evidence}
              groups={snapshot.groups}
            />
          ) : (
            <ApiClientsProvider value={{ media }}>
              <BatchCommandsProvider
                value={batchCommands({ edit: async () => undefined, observe: async () => null })}
              >
                <CaptureWorkspace batch={batch} busy={false} onDirtyChange={setDirty} />
              </BatchCommandsProvider>
            </ApiClientsProvider>
          )}
        </Main>
      </PageContent>
    </ServerStateProvider>
  )
}
