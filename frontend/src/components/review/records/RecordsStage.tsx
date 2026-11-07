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
import { color, radius, space, type } from '../../../theme/generated/tokens'
import { media } from '../../ui/media'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { Pill } from '../../ui/Pill'
import { Small } from '../../ui/primitives'
import { MappingReader } from '../../capture/MappingReader'
import { RecordDetail, STATE_TONE } from './RecordDetail'
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
                <Small>
                  {count.new} new · {count.existing} existing
                </Small>
                {count.decide > 0 && <Pill tone="warn">{count.decide} to decide</Pill>}
              </TypeButton>
            ))}
          </Rail>
          <List aria-label={TYPE_LABELS[type]}>
            {ofType.length === 0 && (
              <Small>No {TYPE_LABELS[type].toLowerCase()} in this batch.</Small>
            )}
            {ofType.map((record) => (
              <RecordButton
                key={record.key}
                type="button"
                aria-label={record.label}
                aria-description={`${STATE_LABELS[record.state]}. ${lotsText(record)}`}
                aria-current={record.key === selected?.key ? 'true' : undefined}
                onClick={() => choose(type, record.key)}
              >
                <span>{record.label}</span>
                <Pill tone={STATE_TONE[record.state]}>{STATE_LABELS[record.state]}</Pill>
                <Small>{lotsText(record)}</Small>
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
              <Small>Choose a record to see its values and who set them.</Small>
            )}
            <details>
              <summary>Read another existing record</summary>
              <MappingReader observe={observe} />
            </details>
          </Detail>
        </Layout>
      </SavingContext.Provider>
    </ReloadContext.Provider>
  )
}

function lotsText(record: BatchRecordDto) {
  const lots = record.lot_ids.length
  return lots ? `Used by ${lots} ${lots === 1 ? 'lot' : 'lots'}` : ''
}

const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(220px, 320px) minmax(0, 1fr);
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
const choice = `
  display: grid;
  gap: ${space[1]};
  justify-items: start;
  padding: ${space[4]};
  border: 0;
  border-radius: ${radius.card};
  background: none;
  color: ${color.fg};
  text-align: left;
  cursor: pointer;
  &[aria-current='true'] {
    background: ${color.surface2};
  }
`
const TypeButton = styled.button`
  ${choice}
  ${type.body}
`
const RecordButton = styled.button`
  ${choice}
`
