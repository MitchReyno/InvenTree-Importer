import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessingInputV6Dto } from '@invimport/contracts'
import { decodeMediaInputs } from '../media/inputs.ts'
import { sha256 } from '../db/authority.ts'

type Call = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

interface Memory {
  /** The batch revision the session last saw. */
  revision: string
  /** Lots by normalised marking, so later evidence of the same item extends its lot. */
  lots: Record<string, string>
}

interface Item {
  marking: string
  quantity?: string
}

/** "LED 0603 red ×500; 16 MHz crystal" lists two items; a `×N` suffix is a printed count. */
export function scriptedItems(text: string): Item[] {
  return text
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(.*?)\s*[×x](\d+)$/u.exec(part)
      return match ? { marking: match[1].trim(), quantity: match[2] } : { marking: part }
    })
}

const keyOf = (marking: string) => marking.toLowerCase().replace(/\s+/g, ' ')

/**
 * The deterministic Examine lead session for `synthetic-session/1`. It cannot see images, so
 * each photo's operator note (or the text after its label's colon) scripts what it holds. It
 * records one observation per listed item, groups the same marking across photos into one lot,
 * states a quantity basis without adding photos of the same items together, and proposes an
 * identity for each new lot. Later turns examine only evidence sent as notices.
 */
export async function syntheticLeadTurn(
  call: Call,
  manifest: ProcessingInputV6Dto,
  cwd: string,
  inbox: { id: string; seq: string; kind: string; payload?: Record<string, unknown> }[],
) {
  const path = join(cwd, 'synthetic-lead.json')
  const memory: Memory = await readFile(path, 'utf8')
    .then((text) => JSON.parse(text) as Memory)
    .catch(() => ({ revision: manifest.capture_revision, lots: {} }))
  // The batch as it is now: other writers may have moved it on since the last turn.
  const view = await call('read_batch', {})
  memory.revision = String(
    (view.batch as { revision?: string } | undefined)?.revision ?? memory.revision,
  )
  const media = decodeMediaInputs(
    Buffer.from(manifest.media.manifest, 'utf8'),
    Buffer.from(manifest.media.sha256, 'hex'),
  )
  const notices = inbox.filter((item) => item.kind === 'evidence')
  const evidence = notices.length
    ? notices.map((item) => ({
        evidenceId: String(item.payload?.evidence_id),
        versionId: String(item.payload?.version_id),
      }))
    : media.versions
        .filter((version) => version.kind === 'original')
        .map((version) => ({ evidenceId: version.evidenceId, versionId: version.versionId }))
  const noteOf = new Map(
    (media.context?.evidenceNotes ?? []).map((entry) => [entry.evidenceId, entry.note]),
  )

  const seen = new Map<string, { observationIds: string[]; photos: number; quantity?: string }>()
  for (const item of evidence) {
    const fetched = await call('fetch_evidence', {
      evidence_id: item.evidenceId,
      version_id: item.versionId,
    })
    const page = (
      fetched.pages as { page: number; width: number; height: number }[] | undefined
    )?.[0]
    if (!fetched.ok || !page) {
      continue
    }
    const label = String(fetched.evidence_label ?? '')
    const text =
      (fetched.evidence_note as string | undefined) ??
      (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label)
    const items = scriptedItems(text)
    const band = Math.floor(page.height / Math.max(items.length, 1))
    for (const [index, entry] of items.entries()) {
      const recorded = await call('record_observation', {
        base_revision: memory.revision,
        evidence_version_id: item.versionId,
        page: page.page,
        region: {
          kind: 'pixels',
          x: 0,
          y: index * band,
          width: page.width,
          height: Math.max(band, 1),
          source_width: page.width,
          source_height: page.height,
        },
        readings: { markings: [entry.marking] },
      })
      memory.revision = String(recorded.revision ?? memory.revision)
      if (!recorded.ok) {
        continue
      }
      const key = keyOf(entry.marking)
      const group = seen.get(key) ?? { observationIds: [], photos: 0 }
      group.observationIds.push(String(recorded.id))
      group.photos += 1
      // The same items seen again are one count, never a sum.
      group.quantity ??= entry.quantity
      seen.set(key, group)
    }
  }

  for (const [key, group] of seen) {
    const existing = memory.lots[key]
    const marking = key
    const basis =
      group.quantity &&
      `label · ${group.photos > 1 ? `same item in ${group.photos} photos` : 'one photo'}`
    const formed = await call('propose_lot', {
      base_revision: memory.revision,
      ...(existing ? { lot_id: existing } : { label: marking }),
      observation_ids: group.observationIds,
      ...(group.quantity && !existing
        ? { estimated_quantity: group.quantity, quantity_basis: basis }
        : {}),
    })
    memory.revision = String(formed.revision ?? memory.revision)
    if (!formed.ok) {
      continue
    }
    const lotId = String(formed.id)
    memory.lots[key] = lotId
    // A new lot gets an identity proposal citing the operator's note on its first photo.
    const note = evidence.map((item) => noteOf.get(item.evidenceId)).find(Boolean)
    if (!existing && note) {
      const source = {
        kind: 'note',
        note_id: note.id,
        text_sha256: sha256(Buffer.from(note.text, 'utf8')).toString('hex'),
      }
      await call('propose', {
        proposal: {
          schema_version: 'bench-intake-proposal/5',
          subject_id: lotId,
          summary: `Identity from the label: ${marking}.`,
          sources: [source],
          ...(group.quantity ? { quantity: { value: group.quantity, status: 'estimated' } } : {}),
          relies_on: { fields: ['identity'], sources: [source] },
        },
      })
    }
  }
  await writeFile(path, JSON.stringify(memory), { mode: 0o600 })
}
