import { sha256 } from '#/db/authority.ts'
import { evidenceNotes } from '#/capture/context-input.ts'
import { syntheticLeadTurn } from './synthetic-lead.ts'
import { decodeMediaInputs } from '#/media/inputs.ts'
import type { SessionDriverContext } from './session-runner.ts'
import type { SessionTurn } from './session-adapters.ts'
import type { ProcessingInputV7Dto } from '@invimport/contracts'

export interface SyntheticResult {
  ok: boolean
  pages?: { page: number; width: number; height: number }[]
  /** Present only when the fetch gave the session an image of that page. */
  delivered?: { page: number }
  items?: { id: string; seq: string; kind: string; payload?: Record<string, unknown> }[]
  /** read_lot: one page of the session's brief. */
  brief?: { revision: string; entries: unknown[]; next_page_token: string | null }
  /** fetch_evidence: the exact source to cite once the image was delivered. */
  source?: Record<string, unknown>
}

/**
 * One question in two related steps about the lot's count, so the stepped form and its effects
 * can be exercised without touching the lot's identity.
 */
export function syntheticQuestion(subjectId: string) {
  return {
    schema_version: 'bench-intake-question/2',
    subject_id: subjectId,
    reason: 'The synthetic session cannot count the lot or see how it is packed.',
    fields: ['quantity'],
    title: 'How many, and how they are packed',
    steps: [
      {
        id: 'left',
        prompt: 'How many items are in this lot?',
        assumption: 'Treating the lot as one item until answered.',
        answer: { kind: 'number' },
      },
      {
        id: 'packing',
        prompt: 'How are they packed?',
        assumption: 'Loose in a bag.',
        answer: {
          kind: 'choice',
          options: [
            { id: 'bag', label: 'Loose in a bag' },
            { id: 'reel', label: 'On a reel', detail: 'Count from the reel label.' },
          ],
          other: true,
        },
      },
    ],
  }
}

/**
 * A picture of the lot's first photo for the synthetic question: the session fetches the photo,
 * so its first page is delivered, and shows the middle half of it with one box. None when the
 * session has no photo, the fetch is refused, or the host gives page sizes without an image.
 */
async function syntheticFigures(
  manifest: SessionDriverContext['manifest'],
  call: (name: string, args: Record<string, unknown>) => Promise<SyntheticResult>,
) {
  const photo = decodeMediaInputs(
    Buffer.from(manifest.media.manifest, 'utf8'),
    Buffer.from(manifest.media.sha256, 'hex'),
  ).versions[0]
  if (!photo) {
    return undefined
  }
  const fetched = await call('fetch_evidence', {
    evidence_id: photo.evidenceId,
    version_id: photo.versionId,
  })
  const page = fetched.pages?.find((item) => item.page === fetched.delivered?.page)
  if (!fetched.ok || !page) {
    return undefined
  }
  const width = Math.max(1, Math.floor(page.width / 2))
  const height = Math.max(1, Math.floor(page.height / 2))
  return [
    {
      source: {
        kind: 'evidence_page',
        evidence_id: photo.evidenceId,
        version_id: photo.versionId,
        page: page.page,
      },
      view: {
        region: { x: Math.floor(page.width / 4), y: Math.floor(page.height / 4), width, height },
        quarter_turns: 0,
        straighten_millidegrees: 0,
      },
      marks: [{ kind: 'box', geometry: { x: 2500, y: 2500, width: 5000, height: 5000 } }],
      caption: 'The lot, as the session sees it',
      why: 'Count the items inside the box.',
    },
  ]
}

/**
 * A `/7` lot session reads its lot's current brief to the last page, and says what it read in
 * its first status line; earlier sessions have no brief.
 */
async function syntheticBriefRead(
  manifest: SessionDriverContext['manifest'],
  call: (name: string, args: Record<string, unknown>) => Promise<SyntheticResult>,
) {
  if (manifest.schema_version !== 'bench-intake-input/7' || !manifest.subject_id) {
    return undefined
  }
  let args: Record<string, unknown> = { lot_id: manifest.subject_id }
  let entries = 0
  let revision = ''
  for (;;) {
    const read = await call('read_lot', args)
    if (!read.ok || !read.brief) {
      return 'Could not read the brief'
    }
    revision = read.brief.revision
    entries += read.brief.entries.length
    if (!read.brief.next_page_token) {
      return `Read the brief at revision ${revision}: ${entries} entries`
    }
    args = { lot_id: manifest.subject_id, page_token: read.brief.next_page_token }
  }
}

type Call = (name: string, args: Record<string, unknown>) => Promise<SyntheticResult>
type LotInput = Extract<ProcessingInputV7Dto, { subject_id: string }>

/**
 * The lot's first photo as a citation: fetched, so the driver hands its image over and releases
 * the view; none when no image was delivered.
 */
async function deliveredPhoto(manifest: SessionDriverContext['manifest'], call: Call) {
  const photo = decodeMediaInputs(
    Buffer.from(manifest.media.manifest, 'utf8'),
    Buffer.from(manifest.media.sha256, 'hex'),
  ).versions[0]
  if (!photo) {
    return undefined
  }
  const fetched = await call('fetch_evidence', {
    evidence_id: photo.evidenceId,
    version_id: photo.versionId,
  })
  return fetched.ok && fetched.delivered && fetched.source ? fetched.source : undefined
}

/**
 * A `/7` Research session's typed output, in the mode it was queued in: an unresolved identity
 * amendment in identify mode, or `research/1` from the delivered note, with only notes in gaps
 * mode since the note names no datasheet or parameter. Images publishes its recipes with its own
 * tool, so it publishes nothing here.
 */
async function publishStageOutput(
  manifest: SessionDriverContext['manifest'],
  note: { id: string; text: string },
  items: NonNullable<SyntheticResult['items']>,
  call: Call,
) {
  if (manifest.schema_version !== 'bench-intake-input/7' || manifest.stage !== 'research') {
    return
  }
  const lot = manifest as LotInput
  const source = {
    kind: 'note',
    note_id: note.id,
    text_sha256: sha256(Buffer.from(note.text, 'utf8')).toString('hex'),
  }
  const photo = await deliveredPhoto(manifest, call)
  const sources = [source, ...(photo ? [photo] : [])]
  const relies_on = {
    fields: ['identity'],
    sources: [
      ...sources,
      ...lot.pinned_proposal_ids.map((id) => ({ kind: 'proposal', proposal_id: id })),
      ...items.map((item) => ({ kind: 'inbox_item', inbox_item_id: item.id })),
    ],
  }
  const base = { subject_id: lot.subject_id, sources, relies_on }
  // A lot input sealed before Match state works in full mode.
  const mode = lot.match?.mode.mode ?? 'full'
  if (mode === 'identify') {
    await call('propose', {
      proposal: {
        schema_version: 'research-identity/1',
        ...base,
        summary: 'The synthetic session found no part number in the note.',
        resolution: 'unresolved',
        tried: ['Read the delivered note.'],
      },
    })
    return
  }
  const values =
    mode === 'full'
      ? {
          category: {
            choice: 'proposed_new',
            name: firstCodePoints(note.text, 64).trim() || 'Uncategorised',
            reason: 'No observed category matches the note.',
            sources: [source],
          },
          description: {
            text: firstCodePoints(note.text, 2048).trim() || 'Synthetic item',
            sources: [source],
          },
        }
      : {}
  const published = await call('propose', {
    proposal: {
      schema_version: 'research/1',
      ...base,
      summary: 'Synthetic research from the delivered note.',
      ...values,
      notes: [{ record: 'part', text: 'Synthetic research from the delivered note.' }],
    },
  })
  // A refused output fails the turn rather than ending it as if Research had published.
  if (!published.ok) {
    throw new Error('synthetic_research_refused')
  }
}

/** The text's first `count` code points, so no surrogate pair is split as a UTF-16 cut would. */
function firstCodePoints(text: string, count: number) {
  return [...text].slice(0, count).join('')
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

  const brief = await syntheticBriefRead(context.manifest, call)
  await call('status', {
    text: brief ?? (turn.resume ? 'Reading new inbox items' : 'Reading the evidence'),
  })
  const read = await call('read_inbox', { after_seq: '0' })
  const items = read.items ?? []
  const note = evidenceNotes(context.manifest.notes, context.manifest.batch_id)[0]
  if (
    note &&
    context.manifest.subject_id &&
    context.manifest.schema_version === 'bench-intake-input/7'
  ) {
    await publishStageOutput(context.manifest, note, items, call)
  } else if (note && context.manifest.subject_id) {
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
    const figures = await syntheticFigures(context.manifest, call)
    await call('ask', {
      ...syntheticQuestion(context.manifest.subject_id),
      ...(figures ? { figures } : {}),
    })
  }
  const last = items.at(-1)
  if (last) {
    await call('read_inbox', { after_seq: last.seq })
  }
}
