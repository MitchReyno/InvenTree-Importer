import type { UseQueryResult } from '@tanstack/react-query'
import type {
  BatchRecordDto,
  CaptureSnapshotDto,
  RecordExistingValuesDto,
  RecordTypeDto,
} from '@invimport/contracts'
import { DESCRIPTION_LIMIT, DescriptionField, SourceChip } from '#/components/ui'

const LABELS: Partial<Record<RecordTypeDto, string>> = {
  category: 'Category description',
  company: 'Company description',
  part: 'Part description',
  manufacturer_part: 'Manufacturer part description',
  supplier_part: 'Supplier part description',
  parameter_template: 'Template description',
  location: 'Location description',
}

const NOT_STORED: Partial<Record<RecordTypeDto, string>> = {
  manufacturer_part: 'Manufacturer part descriptions are not stored yet.',
  supplier_part: 'Supplier part descriptions are not stored yet.',
}

const PROPOSED_NOT_STORED = 'Descriptions for proposed companies are not stored yet.'

const DRAFT_LOCATION_PREFIX = 'location:draft:'

function limitOf(type: RecordTypeDto) {
  return type === 'company' ? DESCRIPTION_LIMIT.company : DESCRIPTION_LIMIT.default
}

type ExistingDescription =
  | { kind: 'pending' }
  | { kind: 'found'; value: string | null }
  | { kind: 'missing'; reason: string }

const NOT_READ = 'InvenTree’s description couldn’t be read, so it isn’t shown.'

/** What the existing-values read says about this record's description, once it has settled. */
function existingDescription(
  record: BatchRecordDto,
  query: UseQueryResult<RecordExistingValuesDto> | undefined,
): ExistingDescription {
  if (!query || (query.isPending && query.fetchStatus === 'idle')) {
    return {
      kind: 'missing',
      reason: 'InvenTree isn’t read in this setup, so its description isn’t shown.',
    }
  }
  if (query.isError) {
    return { kind: 'missing', reason: NOT_READ }
  }
  if (query.isPending) {
    return { kind: 'pending' }
  }
  const entry = query.data.records.find((item) => item.key === record.key)
  if (!entry) {
    // Only records past the per-request limit are left unread.
    return {
      kind: 'missing',
      reason: 'This record wasn’t in this read of InvenTree, so its description isn’t shown.',
    }
  }
  if (entry.status !== 'found') {
    const reason =
      entry.status === 'not_found' ? 'This record wasn’t found in InvenTree.' : NOT_READ

    return { kind: 'missing', reason }
  }
  const field = entry.fields.find((item) => item.name === 'description')

  return { kind: 'found', value: field?.value ?? null }
}

/** The description entered with a new location in Capture, for its draft's record. */
function draftDescription(batch: CaptureSnapshotDto, record: BatchRecordDto) {
  if (!record.key.startsWith(DRAFT_LOCATION_PREFIX)) {
    return undefined
  }
  const draftId = record.key.slice(DRAFT_LOCATION_PREFIX.length)
  const draft = batch.reference_drafts?.find(
    (item) => item.draft_id === draftId && item.kind === 'location',
  )

  return draft?.value.description
}

type Props = {
  batch: CaptureSnapshotDto
  record: BatchRecordDto
  /** The target's current values, read while a mapped record is open. */
  existing?: UseQueryResult<RecordExistingValuesDto>
}

/**
 * A record's description other than a new Part's, which its editor owns: InvenTree's own text for
 * a mapped record, the text entered with a new location, or a disabled field where the app cannot
 * store one yet or the read did not provide it. Stock items and tags have none.
 */
export function RecordDescription({ batch, record, existing }: Props) {
  const label = LABELS[record.type]
  if (!label) {
    return null
  }
  const limit = limitOf(record.type)

  if (record.proposed) {
    return (
      <DescriptionField
        label={label}
        value={null}
        limit={limit}
        disabledReason={PROPOSED_NOT_STORED}
      />
    )
  }
  const notStored = NOT_STORED[record.type]
  if (notStored) {
    return <DescriptionField label={label} value={null} limit={limit} disabledReason={notStored} />
  }
  if (record.mapped) {
    // While the read is in flight, the In InvenTree section says it is reading.
    const read = existingDescription(record, existing)
    if (read.kind === 'pending') {
      return null
    }
    if (read.kind === 'missing') {
      return (
        <DescriptionField label={label} value={null} limit={limit} disabledReason={read.reason} />
      )
    }

    return (
      <DescriptionField
        label={label}
        value={read.value}
        limit={limit}
        source={
          <SourceChip
            source="InvenTree"
            certainty="Existing"
            field={label}
            value={read.value ?? 'No description'}
            why="The description saved on this record in InvenTree."
          />
        }
      />
    )
  }
  const entered = draftDescription(batch, record)
  if (entered === undefined) {
    return null
  }

  return (
    <DescriptionField
      label={label}
      value={entered}
      limit={limit}
      source={
        <SourceChip
          source="You"
          certainty="Entered in Capture"
          tone="user"
          field={label}
          value={entered || 'No description'}
          why="Entered with this new location in Capture."
        />
      }
    />
  )
}
