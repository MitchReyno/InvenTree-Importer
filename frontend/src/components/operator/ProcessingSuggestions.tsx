import {
  tagKey,
  type CaptureEditDto,
  type CaptureSnapshotDto,
  type ProcessingProposalDto,
} from '@invimport/contracts'
import { Small, Button } from '#/components/ui'

type Lot = CaptureSnapshotDto['lots'][number]
type Part = CaptureSnapshotDto['parts'][number]

interface Props {
  lot: Lot
  part: Part | undefined
  proposal: ProcessingProposalDto
  /** The batch quantity an `inherit` lot resolves to; an exact human default is a human count. */
  defaultQuantity: CaptureSnapshotDto['defaults']['quantity']
  /** Only a finished attempt whose input is still current may be accepted; others are history. */
  current: boolean
  disabled: boolean
  edit?: (change: CaptureEditDto['change']) => Promise<boolean | void>
}

/** Uses the inventory adapter's duplicate policy, so only all-ASCII names fold case. */
export function mergeTags(existing: readonly string[], added: readonly string[]) {
  const merged = [...existing]
  for (const tag of added) {
    if (!merged.some((value) => tagKey(value) === tagKey(tag))) {
      merged.push(tag)
    }
  }
  return merged
}

/**
 * Structured suggestions stay candidates. Accepting one is an explicit human edit; an existing
 * human count is never replaced and an existing inventory Part's tags are never changed.
 */
export function ProcessingSuggestions({
  lot,
  part,
  proposal,
  defaultQuantity,
  current,
  disabled,
  edit,
}: Props) {
  if (!('schema_version' in proposal) || proposal.schema_version !== 'bench-intake-proposal/4') {
    return null
  }
  const quantity = proposal.subject_id === lot.id ? proposal.quantity : undefined
  const tags = proposal.tags ?? []
  const effective = lot.quantity.mode === 'inherit' ? defaultQuantity : lot.quantity
  const humanCount = effective.mode === 'set'
  const creating = part?.choice.mode === 'create' ? part.choice : null
  const newTags = creating ? mergeTags(creating.spec.tags, tags) : []
  return (
    <>
      {quantity && (
        <Small>
          Estimated quantity {quantity.value} · from the evidence above ·{' '}
          {!current
            ? 'superseded by newer input, history only'
            : humanCount
              ? 'the human count is kept'
              : 'not yet chosen'}
        </Small>
      )}
      {quantity && current && !humanCount && edit && (
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
        current &&
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
