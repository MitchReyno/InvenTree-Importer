import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  RECORD_TYPES,
  type BatchRecordDto,
  type CaptureSnapshotDto,
  type RecordTypeDto,
} from '@invimport/contracts'
import type { CaptureWorkspaceProps } from '../../../capture/types'
import { batchHref, parseBatchRoute, processingStepFor } from '../../../navigation/batch-route'
import { serverQueryKey, useServerScope } from '../../../queries/scope'
import { useRetainedPollInterval } from '../../operations/LiveUpdates'
import { ENDED_SESSIONS } from '../../../processing/source'
import { clearPending } from '../../../processing/pending-messages'
import type { ProcessingClient } from '../../../processing/types'
import { useQuery } from '@tanstack/react-query'
import { useDirtySources } from '../../../operator/useDirtySources'
import { TYPE_LABELS, STATE_LABELS } from '../../../records/model'
import { useBatchRecords, type RecordsClient } from '../../../records/useBatchRecords'
import { color, radius, size, space, type, typeVar } from '../../../theme/generated/tokens'
import { media } from '../../ui/media'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { Pill } from '../../ui/Pill'
import { Link, Small, Summary } from '../../ui/primitives'
import { MappingReader } from '../../capture/MappingReader'
import { RecordDetail } from './RecordDetail'
import { ParameterMatrix } from './ParameterMatrix'
import { RecordStatePill } from '../../ui/RecordStatePill'
import { FilterChips } from '../../ui/FilterChips'
import { VisuallyHidden } from '../../ui/VisuallyHidden'
import { ReloadContext, SavingContext, type Save } from './draft'

type Props = {
  batch: CaptureSnapshotDto
  client: RecordsClient | undefined
  edit: Save
  observe: CaptureWorkspaceProps['observe']
  onDirtyChange: (dirty: boolean) => void
  /** Loads the current batch; record drafts stay, so a refused save can be retried. */
  reload?: () => Promise<boolean>
  /** Bumped when the batch discards local edits; record drafts are dropped too. */
  discarded?: number
  /** Present with agent sessions: Ask messages the proposing step's session. */
  processing?: ProcessingClient
  /** From the route: the type and record to open first. */
  initialType?: string
  initialRecord?: string
}

/** Review › Records: every record the batch touches, by type, edited once for all its lots. */
export function RecordsStage({
  batch,
  client,
  edit,
  observe,
  onDirtyChange,
  reload,
  discarded = 0,
  initialType,
  initialRecord,
  processing,
}: Props) {
  const routeType = RECORD_TYPES.find((value) => value === initialType) ?? null
  const query = useBatchRecords(client, batch.id, batch.revision)
  const drafts = useDirtySources(onDirtyChange)
  const { isDirty } = drafts
  const [chosenType, setChosenType] = useState<RecordTypeDto | null>(routeType)
  const [chosenKey, setChosenKey] = useState<string | null>(
    routeType && initialRecord ? `${routeType}:${initialRecord}` : null,
  )
  const [filter, setFilter] = useState<RecordFilter>('all')
  const [blocked, setBlocked] = useState(false)
  const [discards, setDiscards] = useState(0)
  const [saving, setSaving] = useState(false)
  const [seenDiscard, setSeenDiscard] = useState(discarded)
  if (seenDiscard !== discarded) {
    setSeenDiscard(discarded)
    setBlocked(false)
    // Unsent Ask messages are record drafts too; the remount must not restore them.
    clearPending(`${batch.id}:ask:`)
  }
  // A failed read after a save keeps the last good records, so the open drafts stay mounted.
  const lastGood = useRef(query.data)
  if (query.data) {
    lastGood.current = query.data
  }
  const records = query.data ?? lastGood.current

  const scope = useServerScope()
  const pollInterval = useRetainedPollInterval()
  const sessions = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batch.id),
    queryFn: () => processing!.read(batch.id),
    enabled: Boolean(processing?.chat),
    refetchInterval: pollInterval,
  })

  // The session of that step working on the record's Part or one of its lots.
  const askFor = (record: BatchRecordDto) => (step: string) => {
    // An archived batch takes no messages.
    const chat = batch.archived ? undefined : processing?.chat
    // The Part's own session first, then a lot's; never one that will not read it.
    const owners = [...record.part_ids, ...record.lot_ids]
    const job = owners
      .flatMap((owner) =>
        (sessions.data?.jobs ?? []).filter(
          (item) =>
            item.subject_id === owner &&
            item.session_state &&
            !ENDED_SESSIONS.has(item.session_state) &&
            processingStepFor(item.stage) === step,
        ),
      )
      .at(0)
    if (!chat || !job) {
      return undefined
    }
    return async (text: string, key: string) => {
      await chat.call(processing, batch.id, job.id, { idempotency_key: key, text }, key)
    }
  }

  // A link to a record, such as a Needs you item, opens it unless a draft is open (the navigation
  // guard keeps the route then). The stage replaces history itself, so it follows the hash directly.
  useEffect(() => {
    function follow() {
      const parsed = parseBatchRoute(location.hash.slice(1))
      const route = parsed.kind === 'route' && parsed.batchId === batch.id ? parsed.route : null
      if (route?.tab !== 'review' || route.view !== 'records' || isDirty()) {
        return
      }
      const nextType = RECORD_TYPES.find((value) => value === route.recordType) ?? null
      setBlocked(false)
      setChosenType(nextType)
      setChosenKey(nextType && route.recordId ? `${nextType}:${route.recordId}` : null)
    }

    addEventListener('hashchange', follow)
    return () => removeEventListener('hashchange', follow)
  }, [batch.id, isDirty])

  if (!client) {
    return <Banner tone="plain">Records are not available in this setup.</Banner>
  }
  if (!records && query.isPending) {
    return <Small role="status">Reading records…</Small>
  }
  if (!records) {
    return (
      <div role="alert">
        <Banner tone="bad">
          Records are unavailable. Each lot’s values are still in{' '}
          <a href={batchHref(batch.id, { tab: 'review', view: 'lots' })}>Lots</a>.
        </Banner>
      </div>
    )
  }
  // Just after a save the previous read stands in until the new revision's read arrives.
  const refreshing = query.isPlaceholderData && query.isFetching
  const stale = query.isError || (!refreshing && records.revision !== batch.revision)
  const disabled = stale || refreshing || batch.archived

  const withRecords = records.counts.filter(
    (count) => count.new + count.existing + count.decide > 0,
  )
  const type: RecordTypeDto = chosenType ?? withRecords[0]?.type ?? 'part'
  const ofType = records.records.filter((record) => record.type === type)
  const shown = ofType.filter((record) => matchesFilter(record, filter))
  const selected = ofType.find((record) => record.key === chosenKey) ?? null

  function choose(nextType: RecordTypeDto, key: string | null) {
    if (drafts.isDirty()) {
      setBlocked(true)
      return
    }
    setBlocked(false)
    setChosenType(nextType)
    setChosenKey(key)
    const recordId = key?.slice(nextType.length + 1)
    history.replaceState(
      history.state,
      '',
      batchHref(batch.id, { tab: 'review', view: 'records', recordType: nextType, recordId }),
    )
  }

  return (
    <ReloadContext.Provider value={reload}>
      <SavingContext.Provider value={{ saving, setSaving }}>
        <Header>
          <div>
            <PageHeading>Every InvenTree record this batch touches</PageHeading>
            <Small>Each record names who set its values; edits wait for a save.</Small>
          </div>
          <FilterChips
            label="Filter records"
            value={filter}
            onChange={(id) => setFilter(id as RecordFilter)}
            options={RECORD_FILTERS.map(([id, label]) => ({
              id,
              label,
              count: ofType.filter((record) => matchesFilter(record, id)).length,
            }))}
          />
        </Header>
        <Layout>
          <Rail aria-label="Record types">
            {records.counts.map((count) => (
              <TypeButton
                key={count.type}
                type="button"
                aria-current={count.type === type ? 'true' : undefined}
                onClick={() => choose(count.type, null)}
              >
                <strong>{TYPE_LABELS[count.type]}</strong>
                {count.decide > 0 ? (
                  <Counts>
                    <VisuallyHidden>
                      {count.new} new · {count.existing} existing,{' '}
                    </VisuallyHidden>
                    <Pill tone="warn">{count.decide} to decide</Pill>
                  </Counts>
                ) : (
                  <Counts>
                    {count.new} new · {count.existing}
                    <VisuallyHidden> existing</VisuallyHidden>
                  </Counts>
                )}
              </TypeButton>
            ))}
          </Rail>
          <List aria-label={TYPE_LABELS[type]}>
            {ofType.length === 0 && (
              <Small>No {TYPE_LABELS[type].toLowerCase()} in this batch.</Small>
            )}
            {ofType.length > 0 && shown.length === 0 && (
              <Small>No {TYPE_LABELS[type].toLowerCase()} match this filter.</Small>
            )}
            {shown.map((record) => (
              <RecordButton
                key={record.key}
                type="button"
                aria-label={record.label}
                aria-description={`${STATE_LABELS[record.state]}. ${lotsText(record)}`}
                aria-current={record.key === selected?.key ? 'true' : undefined}
                onClick={() => choose(type, record.key)}
              >
                <strong>{record.label}</strong>
                <RecordStatePill state={record.state}>{STATE_LABELS[record.state]}</RecordStatePill>
                {lotsText(record) && <RowDetail>{lotsText(record)}</RowDetail>}
              </RecordButton>
            ))}
          </List>
          <Detail>
            {stale && (
              <Banner
                tone="warn"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void (async () => {
                        await reload?.()
                        await query.refetch()
                      })()
                    }}
                  >
                    Load current values
                  </Button>
                }
              >
                Records may be out of date, so editing waits for current values. Unsaved record
                changes stay.
              </Banner>
            )}
            {blocked && (
              <div role="alert">
                <Banner
                  tone="warn"
                  action={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (selected) {
                          clearPending(`${batch.id}:ask:${selected.key}:`)
                        }
                        setDiscards((value) => value + 1)
                        setBlocked(false)
                      }}
                    >
                      Discard changes
                    </Button>
                  }
                >
                  Save or discard this record’s changes before opening another.
                </Banner>
              </div>
            )}
            {type === 'parameter' && (
              <ParameterMatrix
                batch={batch}
                records={records.records}
                open={(key) => choose('parameter', key)}
              />
            )}
            {selected && (
              <RecordNav aria-label="Record">
                <Link href={batchHref(batch.id, { tab: 'review', view: 'records' })}>Records</Link>
                <span aria-hidden="true">›</span>
                <span>{TYPE_LABELS[type]}</span>
                <span aria-hidden="true">›</span>
                <strong>{selected.label}</strong>
                <Steps>
                  {(() => {
                    const index = shown.findIndex((record) => record.key === selected.key)
                    const previous = index > 0 ? shown[index - 1] : undefined
                    const next = index >= 0 ? shown[index + 1] : undefined
                    return (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!previous}
                          aria-label={`Previous record${previous ? `: ${previous.label}` : ''}`}
                          onClick={() => previous && choose(type, previous.key)}
                        >
                          ‹
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!next}
                          aria-label={`Next record${next ? `: ${next.label}` : ''}`}
                          onClick={() => next && choose(type, next.key)}
                        >
                          ›
                        </Button>
                      </>
                    )
                  })()}
                </Steps>
              </RecordNav>
            )}
            {selected ? (
              <RecordDetail
                key={`${selected.key}:${discards}:${discarded}`}
                batch={batch}
                record={selected}
                save={edit}
                disabled={disabled}
                reportFor={drafts.forSource}
                ask={askFor(selected)}
              />
            ) : (
              <Empty>Choose a record to see its values and who set them.</Empty>
            )}
            <details>
              <Summary>Read another existing record</Summary>
              <MappingReader observe={observe} />
            </details>
          </Detail>
        </Layout>
      </SavingContext.Provider>
    </ReloadContext.Provider>
  )
}

type RecordFilter = 'all' | 'new' | 'update' | 'choose' | 'edited'

const RECORD_FILTERS: [RecordFilter, string][] = [
  ['all', 'All'],
  ['new', 'New'],
  ['update', 'Updates'],
  ['choose', 'Needs a decision'],
  ['edited', 'Edited by you'],
]

function matchesFilter(record: BatchRecordDto, filter: RecordFilter) {
  if (filter === 'all') {
    return true
  }
  if (filter === 'edited') {
    return record.fields.some((field) => field.origin.kind === 'operator')
  }

  return record.state === filter
}

function lotsText(record: BatchRecordDto) {
  const lots = record.lot_ids.length
  return lots ? `Used by ${lots} ${lots === 1 ? 'lot' : 'lots'}` : ''
}

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: ${space[4]} ${space[8]};
  margin-bottom: ${space[6]};
`
const RecordNav = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
  strong {
    color: ${color.fg};
  }
`
const Steps = styled.span`
  display: inline-flex;
  gap: ${space[2]};
  margin-left: auto;
`
const PageHeading = styled.h2`
  margin: 0;
  ${type.h2}
`
const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(200px, 240px) minmax(220px, 320px) minmax(0, 1fr);
  gap: ${space[6]};
  align-items: start;
  ${media.stacked} {
    grid-template-columns: 1fr;
  }
`
const column = `
  display: grid;
  gap: ${space[2]};
  padding: ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
const Rail = styled.nav`
  ${column}
`
const List = styled.section`
  ${column}
`
const Detail = styled.div`
  display: grid;
  gap: ${space[4]};
  min-width: 0;
`
/** A selectable row: name left, counts or state right; the current row is accent-weak. */
const choice = `
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space[1]} ${space[4]};
  padding: ${space[4]} ${space[7]};
  border: 1px solid transparent;
  border-radius: ${radius.btn};
  background: none;
  color: ${color.fg};
  text-align: left;
  cursor: pointer;
  &:hover {
    background: ${color.surface2};
  }
  &[aria-current='true'] {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`
const TypeButton = styled.button`
  ${choice}
  ${type.body}
`
const Counts = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: ${space[3]};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
  white-space: nowrap;
`
const RecordButton = styled.button`
  ${choice}
  ${type.body}
  border-top-color: ${color.line};
  border-radius: 0;
  &:first-of-type {
    border-top-color: transparent;
  }
  &[aria-current='true'] {
    border-radius: ${radius.btn};
  }
`
/** An empty state sits in a muted card, never as bare text beside the columns. */
const Empty = styled.p`
  margin: 0;
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
const RowDetail = styled.span`
  grid-column: 1 / -1;
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
