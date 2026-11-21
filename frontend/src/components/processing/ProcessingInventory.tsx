import styled from 'styled-components'
import type {
  BatchRecordDto,
  BatchRecordsDto,
  CaptureSnapshotDto,
  ProcessingJobDto,
} from '@invimport/contracts'
import { useApiClients } from '#/context'
import { batchHref } from '#/navigation/batch-route'
import { STATE_LABELS } from '#/records/model'
import { locationUse, locationUseText, stockQuantityText } from '#/records/locations'
import { useBatchRecords } from '#/records/useBatchRecords'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { Button, CompareTable, Link, RecordStatePill, linkTouchArea } from '#/components/ui'
import { Card, CardTitle, Muted } from './ProcessingParts'

const NOT_KNOWN = 'Not known'

type Props = {
  batch: CaptureSnapshotDto
  /** The Inventory step's jobs, with their open questions. */
  jobs: ProcessingJobDto[]
  onOpenSession: (jobId: string) => void
}

type Lot = CaptureSnapshotDto['lots'][number]

type OpenQuestion = { id: string; jobId: string; lot: Lot; prompt: string; reason: string }

/**
 * Open Inventory clarifications about one of the batch's lots, with the job whose session asked.
 * A quantity question asks for a count, not about an existing record, so it has no comparison.
 */
function lotQuestions(batch: CaptureSnapshotDto, jobs: ProcessingJobDto[]): OpenQuestion[] {
  return jobs.flatMap((job) =>
    job.questions
      .filter((question) => question.state === 'open' && question.spec.kind !== 'quantity')
      .flatMap((question) => {
        const lot = batch.lots.find((item) => item.id === question.spec.subject_id)
        if (!lot) {
          return []
        }

        return [
          {
            id: question.id,
            jobId: job.id,
            lot,
            prompt: question.spec.prompt,
            reason: question.spec.reason,
          },
        ]
      }),
  )
}

/** Review › Records' address for a record; its key is `<type>:<id>`. */
function recordHref(batchId: string, record: BatchRecordDto) {
  return batchHref(batchId, {
    tab: 'review',
    view: 'records',
    recordType: record.type,
    recordId: record.key.slice(record.type.length + 1),
  })
}

function recordFor(records: BatchRecordsDto | undefined, type: string, lotId: string) {
  return records?.records.find((record) => record.type === type && record.lot_ids.includes(lotId))
}

/**
 * Processing › Inventory: each lot's Part match, the existing records its questions ask about, and
 * the location and company matches. Values are Review's records; changes are made there.
 */
export function ProcessingInventory({ batch, jobs, onOpenSession }: Props) {
  const { records: client } = useApiClients()
  const query = useBatchRecords(client, batch.id, batch.revision)
  const records = query.data
  const questions = lotQuestions(batch, jobs)
  // Records list only active lots, so a split or merged lot's predecessor drops out here too.
  const activeLots = batch.lots.filter((lot) =>
    records?.records.some((record) => record.lot_ids.includes(lot.id)),
  )
  const matches = (records?.records ?? []).filter(
    (record) => record.type === 'location' || record.type === 'company',
  )

  return (
    <>
      {!client && <Muted>Records are not available in this setup.</Muted>}
      {client && query.isError && !records && (
        <Muted role="alert">
          Records are unavailable, so Part, location and company matches aren’t shown.
        </Muted>
      )}
      {records && (
        <Card aria-label="Parts">
          <CardTitle>Parts</CardTitle>
          <Rows>
            {activeLots.map((lot) => {
              const part = recordFor(records, 'part', lot.id)

              return (
                <li key={lot.id}>
                  <span>
                    <b>{lot.label}</b>
                    {part?.reuse && (
                      <Muted>
                        Not reusing {part.reuse.label}: {part.reuse.reason}
                      </Muted>
                    )}
                    {part?.decision && <Muted>{part.decision.detail}</Muted>}
                  </span>
                  {part ? (
                    <>
                      <Link href={recordHref(batch.id, part)}>{part.label}</Link>
                      <RecordStatePill state={part.state}>
                        {STATE_LABELS[part.state]}
                      </RecordStatePill>
                    </>
                  ) : (
                    <Muted>No Part yet</Muted>
                  )}
                </li>
              )
            })}
          </Rows>
        </Card>
      )}
      {questions.map((question) => {
        const { lot } = question
        const part = recordFor(records, 'part', lot.id)
        const location = recordFor(records, 'location', lot.id)

        return (
          <Card key={question.id} aria-label={`Compare before answering: ${lot.label}`}>
            <CardTitle>Compare before answering</CardTitle>
            <b>{question.prompt}</b>
            <Muted>{question.reason}</Muted>
            <CompareTable
              caption={`${lot.label} beside the InvenTree record the question asks about`}
              records={[`This batch: ${lot.label}`, 'In InvenTree']}
              rows={[
                { field: 'Part', values: [part?.label ?? NOT_KNOWN, NOT_KNOWN] },
                { field: 'Date code', values: [NOT_KNOWN, NOT_KNOWN] },
                { field: 'Location', values: [location?.label ?? NOT_KNOWN, NOT_KNOWN] },
                {
                  field: 'Quantity',
                  values: [stockQuantityText(records?.records, lot.id), NOT_KNOWN],
                },
              ]}
            />
            <Muted>The question doesn’t carry the InvenTree record’s fields.</Muted>
            <span>
              <Button size="sm" onClick={() => onOpenSession(question.jobId)}>
                Answer in the session
              </Button>
            </span>
          </Card>
        )
      })}
      {matches.length > 0 && (
        <Card aria-label="Locations and companies">
          <CardTitle>Locations and companies</CardTitle>
          <Rows>
            {matches.map((record) => (
              <li key={record.key}>
                <span>
                  <Link href={recordHref(batch.id, record)}>{record.label}</Link>
                  {record.type === 'location' && (
                    <Muted>{locationUseText(locationUse(batch, record))}</Muted>
                  )}
                  {record.type === 'company' && <Muted>Company</Muted>}
                </span>
                <RecordStatePill state={record.state}>{STATE_LABELS[record.state]}</RecordStatePill>
              </li>
            ))}
          </Rows>
        </Card>
      )}
    </>
  )
}

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${space[2]} ${space[4]};
    padding: ${space[4]} 0;
    border-top: 1px solid ${color.line};
    overflow-wrap: anywhere;
  }
  li:first-child {
    border-top: 0;
  }
  li > span:first-child {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  b {
    font-weight: ${typeVar.bodyStrong.weight};
  }
  a {
    ${linkTouchArea}
  }
`
