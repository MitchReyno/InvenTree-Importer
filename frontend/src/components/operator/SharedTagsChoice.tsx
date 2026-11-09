import {
  effectiveSettingsIntent,
  type CaptureEditDto,
  type CaptureSnapshotDto,
} from '@invimport/contracts'
import { Small, Button } from '#/components/ui'
import { mergeTags } from './ProcessingSuggestions'

type Part = CaptureSnapshotDto['parts'][number]

interface Props {
  batch: CaptureSnapshotDto
  part: Part
  disabled: boolean
  edit: (change: CaptureEditDto['change']) => Promise<boolean | void>
}

/**
 * Batch manual shared tags are human intent for each new shared Part; applying them is an explicit
 * reviewed edit of that Part's create spec. Existing inventory Parts keep their own tags.
 */
export function SharedTagsChoice({ batch, part, disabled, edit }: Props) {
  const manual = effectiveSettingsIntent(batch).shared_tags.manual
  if (!manual.length) {
    return null
  }
  if (part.choice.mode !== 'create') {
    return (
      <Small>
        Batch shared tags ({manual.join(', ')}) apply only to new Parts; an existing inventory
        Part&apos;s tags are not changed.
      </Small>
    )
  }
  const choice = part.choice
  const merged = mergeTags(choice.spec.tags, manual)
  const missing = merged.slice(choice.spec.tags.length)
  return (
    <>
      <Small>Batch shared tags (human): {manual.join(', ')}</Small>
      {missing.length > 0 && (
        <Button
          type="button"
          disabled={disabled}
          onClick={() =>
            void edit({
              kind: 'part',
              id: part.id,
              choice: { ...choice, spec: { ...choice.spec, tags: merged } },
            })
          }
        >
          Add batch tags {missing.join(', ')} to {part.label}
        </Button>
      )}
    </>
  )
}
