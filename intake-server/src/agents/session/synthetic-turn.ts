import { sha256 } from '#/db/authority.ts'
import { evidenceNotes } from '#/capture/context-input.ts'
import { syntheticLeadTurn } from './synthetic-lead.ts'
import type { SessionDriverContext } from './session-runner.ts'
import type { SessionTurn } from './session-adapters.ts'

export interface SyntheticResult {
  ok: boolean
  items?: { id: string; seq: string; kind: string; payload?: Record<string, unknown> }[]
}

export async function syntheticTurn(
  turn: Pick<SessionTurn, 'resume'>,
  context: Pick<SessionDriverContext, 'manifest' | 'cwd'>,
  call: (name: string, args: Record<string, unknown>) => Promise<SyntheticResult>,
) {
  if (context.manifest.stage === 'examine') {
    await call('status', {
      text: turn.resume ? 'Examining new evidence' : 'Finding items in the photos',
    })
    const read = await call('read_inbox', { after_seq: '0' })
    const items = read.items ?? []
    await syntheticLeadTurn(
      call as unknown as Parameters<typeof syntheticLeadTurn>[0],
      context.manifest,
      context.cwd,
      items,
    )
    for (const item of items.filter((entry) => entry.kind === 'chat')) {
      await call('reply', { inbox_item_id: item.id, text: 'Synthetic reply: noted.' })
    }
    const last = items.at(-1)
    if (last) {
      await call('read_inbox', { after_seq: last.seq })
    }
    return
  }

  await call('status', { text: turn.resume ? 'Reading new inbox items' : 'Reading the evidence' })
  const read = await call('read_inbox', { after_seq: '0' })
  const items = read.items ?? []
  const note = evidenceNotes(context.manifest.notes, context.manifest.batch_id)[0]
  if (note && context.manifest.subject_id) {
    const source = {
      kind: 'note',
      note_id: note.id,
      text_sha256: sha256(Buffer.from(note.text, 'utf8')).toString('hex'),
    }
    await call('propose', {
      proposal: {
        schema_version: 'bench-intake-proposal/5',
        subject_id: context.manifest.subject_id,
        summary: 'Synthetic proposal from the delivered note.',
        sources: [source],
        relies_on: {
          fields: ['identity'],
          sources: [
            source,
            // The lead session's identity this session started from.
            ...context.manifest.pinned_proposal_ids.map((id) => ({
              kind: 'proposal',
              proposal_id: id,
            })),
            ...items.map((item) => ({ kind: 'inbox_item', inbox_item_id: item.id })),
          ],
        },
        // Research publishes catalogue values; with no observed references they are proposals.
        ...(context.manifest.stage === 'research'
          ? {
              catalogue: {
                category: {
                  choice: 'proposed_new',
                  name: note.text.slice(0, 64).trim() || 'Uncategorised',
                  reason: 'No observed category matches the note.',
                  sources: [source],
                },
                parameters: [],
                manufacturer: null,
                supplier: null,
                description: null,
              },
            }
          : {}),
      },
    })
  }
  for (const item of items.filter((entry) => entry.kind === 'chat')) {
    await call('reply', { inbox_item_id: item.id, text: 'Synthetic reply: noted.' })
  }
  const answered = items.some((item) => item.kind === 'answer')
  if (!answered && !turn.resume && context.manifest.subject_id) {
    await call('ask', {
      kind: 'quantity',
      subject_id: context.manifest.subject_id,
      prompt: 'How many items are in this lot?',
      reason: 'The synthetic session cannot count.',
      fields: ['quantity'],
      assumption: 'Treating the lot as one item until answered.',
    })
  }
  const last = items.at(-1)
  if (last) {
    await call('read_inbox', { after_seq: last.seq })
  }
}
