import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { HumanNote } from '#/components/capture/HumanNote'
import { AttachmentOutcome } from '#/components/changes/AttachmentOutcome'
import { PartAttachments } from '#/components/changes/PartAttachments'
import { RoundOutcome } from '#/components/changes/RoundOutcome'
import { RetiredLots } from '#/components/operator/RetiredLots'
import { setDebugMode } from '#/test/debug-mode'

const digest = 'f'.repeat(64)

const cases: { name: string; ui: () => ReactElement; operator: string; internal: string }[] = [
  {
    name: 'a written note keeps its attribution for debug mode',
    ui: () => (
      <HumanNote
        note={
          {
            id: 'note-7f3a',
            subject_id: null,
            text: 'Counted at the bench.',
            actor_id: 'actor-91c2',
            created_at: '2026-11-19T01:00:00Z',
          } as never
        }
        batch={{ lots: [], parts: [] } as never}
      />
    ),
    operator: 'Counted at the bench.',
    internal: 'actor-91c2',
  },
  {
    name: 'a Part attachment keeps its file identity for debug mode',
    ui: () => (
      <PartAttachments
        attachments={[
          {
            artifact_key: 'artifact-1',
            part_label: 'ATmega328P',
            part_id: 42,
            kind: 'original',
            prior_remote_pk: null,
            version_id: 'version-c01f',
            blob_sha256: digest,
            byte_size: 2048,
            media_type: 'image/png',
            prior_run_id: null,
          } as never,
        ]}
      />
    ),
    operator: 'Part #42',
    internal: digest,
  },
  {
    name: 'an attachment outcome keeps its bytes for debug mode',
    ui: () => (
      <AttachmentOutcome
        attachment={
          {
            lot_label: 'Lot 7',
            kind: 'original',
            certainty: 'confirmed',
            remote_pk: 311,
            verification: 'verified',
            recovery_action: null,
            byte_size: 2048,
            blob_sha256: digest,
          } as never
        }
        busy={false}
        recover={() => {}}
      />
    ),
    operator: 'Attachment #311 was verified',
    internal: digest,
  },
  {
    name: 'an Added round keeps its run and approval IDs for debug mode',
    ui: () => (
      <RoundOutcome
        run={
          {
            run_id: 'run-5d1e',
            approval_id: 'approval-77b0',
            preparation_id: 'preparation-1',
            batch_id: 'batch-1',
            revision: '3',
            round_number: '1',
            state: 'settled_complete',
            effect_certainty: 'confirmed',
            confirmed_stock_ids: [],
            attributed_stock_ids: [],
            cancellation_requested: false,
            dispatch_state: 'finished',
            operations: [],
            cursor: { stream_id: 'stream-1', sequence: '1' },
          } as never
        }
        busy={false}
        command={() => {}}
        targetUrl={null}
      />
    ),
    operator: 'Round 1',
    internal: 'run-5d1e',
  },
  {
    name: 'a retired lot keeps its retired revision for debug mode',
    ui: () => (
      <RetiredLots
        batch={{ lots: [{ id: 'lot-new', label: 'Packet A2' }] } as never}
        review={
          {
            retired_lots: [
              {
                lot_id: 'lot-old-4c1a',
                label: 'Packet A',
                action: 'split',
                successor_lot_ids: ['lot-new'],
                retired_revision: '41',
              },
            ],
          } as never
        }
      />
    ),
    operator: 'Into Packet A2',
    internal: 'lot-old-4c1a',
  },
]

afterEach(() => setDebugMode(false))

describe('developer details at their call sites', () => {
  it.each(cases)('$name', ({ ui, operator, internal }) => {
    const { rerender } = render(ui())
    expect(screen.getByText(new RegExp(operator))).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(internal)

    setDebugMode(true)
    rerender(ui())

    expect(screen.getByRole('group', { name: /^Debug:/ })).toHaveTextContent(internal)
    expect(screen.getByText(new RegExp(operator))).toBeInTheDocument()
  })
})
