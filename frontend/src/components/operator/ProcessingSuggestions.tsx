import type {
  CaptureEditDto,
  CaptureSnapshotDto,
  ProcessingProposalDto,
} from '@invimport/contracts'
import { Button, Small } from '../ui/primitives'

type Lot = CaptureSnapshotDto['lots'][number]
type Part = CaptureSnapshotDto['parts'][number]

interface Props {
  lot: Lot
  part: Part | undefined
  proposal: ProcessingProposalDto
  disabled: boolean
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
}

/** Matches the inventory tag adapter: exact or ASCII case-insensitive duplicates are one tag. */
function mergeTags(existing: readonly string[], suggested: readonly string[]) {
  const merged = [...existing]
  for (const tag of suggested) {
    if (!merged.some((value) => value === tag || value.toLowerCase() === tag.toLowerCase())) {
      merged.push(tag)
    }
  }
  return merged
}

/**
 * Structured suggestions stay candidates. Accepting one is an explicit human edit; an existing
 * human count is never replaced and an existing inventory Part's tags are never changed.
 */
export function ProcessingSuggestions({ lot, part, proposal, disabled, edit }: Props) {
  if (!('schema_version' in proposal) || proposal.schema_version !== 'bench-intake-proposal/4') {
    return null
  }
  const quantity = proposal.subject_id === lot.id ? proposal.quantity : undefined
  const tags = proposal.tags ?? []
  const humanCount = lot.quantity.mode === 'set'
  const creating = part?.choice.mode === 'create' ? part.choice : null
  const newTags = creating ? mergeTags(creating.spec.tags, tags) : []
  return (
    <>
      {quantity && (
        <Small>
          Estimated quantity {quantity.value} · from the evidence above ·{' '}
          {humanCount ? 'the human count is kept' : 'not yet chosen'}
        </Small>
      )}
      {quantity && !humanCount && edit && (
        <Button
          type="button"
          disabled={disabled}
          onClick={() =>
            void edit({ kind: 'lot', id: lot.id, quantity: { mode: 'set', value: quantity.value } })
          }
        >
          Use estimated quantity {quantity.value} for {lot.label}
        </Button>
      )}
      {tags.length > 0 && <Small>Suggested shared part tags (Auto): {tags.join(', ')}</Small>}
      {tags.length > 0 &&
        creating &&
        part &&
        edit &&
        newTags.length > creating.spec.tags.length && (
          <Button
            type="button"
            disabled={disabled}
            onClick={() =>
              void edit({
                kind: 'part',
                id: part.id,
                choice: { ...creating, spec: { ...creating.spec, tags: newTags } },
              })
            }
          >
            Add suggested tags to {part.label}
          </Button>
        )}
      {tags.length > 0 && part?.choice.mode === 'set' && (
        <Small>An existing inventory Part&apos;s tags are not changed.</Small>
      )}
    </>
  )
}
