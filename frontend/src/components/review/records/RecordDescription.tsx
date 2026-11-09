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

/** The InvenTree description the existing-values read returned for this record, if it did. */
function existingDescription(
  record: BatchRecordDto,
  query: UseQueryResult<RecordExistingValuesDto> | undefined,
) {
  const entry = query?.data?.records.find((item) => item.key === record.key)
  if (entry?.status !== 'found') {
    return undefined
  }

  return entry.fields.find((field) => field.name === 'description')
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
 * store or read one yet. Stock items and tags have none.
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
    // While the read is pending or failed, the In InvenTree section says so.
    const found = existingDescription(record, existing)

    return found ? (
      <DescriptionField
        label={label}
        value={found.value}
        limit={limit}
        source={<SourceChip source="InvenTree" certainty="Existing" />}
      />
    ) : null
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
      source={<SourceChip source="You" certainty="Entered in Capture" tone="user" />}
    />
  )
}
