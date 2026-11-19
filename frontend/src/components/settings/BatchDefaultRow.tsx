import type { BatchDefaultRecordDto, CatalogueModelDto } from '@invimport/contracts'
import { Button, SettingRow, Small } from '#/components/ui'
import { SearchableReferencePicker } from '#/forms'
import { useApiClients } from '#/context'
import { useCatalogue } from '#/catalogue/useCatalogue'
import { Stack } from './agents/Stack'
import type { Draft } from './BatchDefaultsForm'

const NOUN = { location: 'location', supplier: 'supplier' } as const

/** A saved record InvenTree didn't name; the picker adds its number. */
const unnamed = (record: BatchDefaultRecordDto) =>
  record.status === 'not_found' ? 'Not found' : 'Not checked'

/** What Settings knows about a saved record that isn't usable now. */
function recordNote(field: keyof Draft, record: BatchDefaultRecordDto | null) {
  if (record?.status === 'not_found') {
    return `This ${NOUN[field]} wasn't found in InvenTree, so new batches start without it.`
  }
  if (record?.status === 'unavailable') {
    return `InvenTree couldn't be checked for this ${NOUN[field]} just now.`
  }
  return null
}

/** One default, picked from InvenTree through the batch-free catalogue, or cleared. */
export function BatchDefaultRow({
  field,
  model,
  label,
  help,
  clearLabel,
  value,
  busy,
  onChoose,
}: {
  field: keyof Draft
  model: CatalogueModelDto
  label: string
  help: string
  clearLabel: string
  value: BatchDefaultRecordDto | null
  busy: boolean
  onChoose: (field: keyof Draft, record: BatchDefaultRecordDto | null) => void
}) {
  const { catalogue: client } = useApiClients()
  const catalogue = useCatalogue(client, null, model, true)
  const note = recordNote(field, value)

  return (
    <SettingRow label={label} help={help}>
      <Stack>
        <SearchableReferencePicker
          label={label}
          noun={`${NOUN[field]}s`}
          value={value ? { pk: value.pk, label: value.label ?? unnamed(value) } : null}
          candidates={catalogue.candidates}
          coverage={catalogue.coverage}
          status={catalogue.status}
          search={catalogue.search}
          disabled={busy}
          onChange={(record) =>
            onChoose(field, { pk: record.pk, label: record.name, status: 'found' })
          }
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onChoose(field, null)}
          >
            {clearLabel}
          </Button>
        )}
        {note && <Small role="status">{note}</Small>}
      </Stack>
    </SettingRow>
  )
}
