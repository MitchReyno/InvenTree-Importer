import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { HumanNote } from '#/components/capture/HumanNote'
import { AttachmentOutcome } from '#/components/changes/AttachmentOutcome'
import { PartAttachments } from '#/components/changes/PartAttachments'
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
