import { Input } from '../ui/primitives'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { media } from '../ui/media'
import { hoverTransition } from '../ui/motion'
import { useEffect, useRef, useState } from 'react'
import { NewBatchForm } from './NewBatchForm'
import { BatchThumbnail } from './BatchThumbnail'
import { AddedBar, BatchCounts, BatchState } from './batchState'
import { Pill } from '../ui/Pill'
import type { InboxWorkflowDto, CaptureListQueryDto } from '@invimport/contracts'
import type { CaptureList } from '../../../../contracts/generated/api.d.ts'
import type { BatchCreate } from '../../../../contracts/generated/api.d.ts'
import type { Client } from '../../capture/client'
import styled from 'styled-components'
import { color, pageWidth, radius, size, space, type, typeVar } from '../../theme/generated/tokens'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { batchHref } from '../../navigation/batch-route'

type InboxBatch = CaptureList['batches'][number] & { workflow?: InboxWorkflowDto }
interface BatchesClient extends Omit<Client, 'list'> {
  list: (query?: CaptureListQueryDto) => Promise<{ batches: InboxBatch[]; truncated: boolean }>
}
interface Props {
  client: BatchesClient
  onDirtyChange: (dirty: boolean) => void
}

const INBOX_PAGE_SIZE = 10

function resumeAction(batch: InboxBatch) {
  if (batch.workflow?.open_questions) {
    return {
      href: batchHref(batch.id, { tab: 'processing', step: 'overview' }),
      label: `Open ${batch.workflow.open_questions} questions`,
    }
  }
  if (batch.workflow?.lots) {
    return {
      href: batchHref(batch.id, { tab: 'review', view: 'lots' }),
      label: `Review ${batch.workflow.lots} lots`,
    }
  }
  return { href: batchHref(batch.id, { tab: 'capture' }), label: 'Continue Capture' }
}

export function Batches({ client, onDirtyChange }: Props) {
  const scope = useServerScope()
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [offset, setOffset] = useState(0)
  const options = {
    q: submitted,
    archived: archived ? ('include' as const) : ('exclude' as const),
    offset: String(offset),
  }
  const batchesQuery = useQuery({
    queryKey: serverQueryKey(scope, 'batches', JSON.stringify(options)),
    queryFn: () => client.list(options),
  })
  const batches = batchesQuery.data
  // Command identity outlives the mountable editor, including discard/reopen after lost ACK.
  const createIntent = useRef({ payload: '', key: crypto.randomUUID() })

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  function reportDraftDirty(dirty: boolean) {
    if (dirty) {
      // A list refresh must not unmount an automatically opened form containing human input.
      setCreating(true)
    }
    onDirtyChange(dirty)
  }

  function createBatch(input: BatchCreate) {
    const payload = JSON.stringify(input)
    if (createIntent.current.payload !== payload) {
      createIntent.current = { payload, key: crypto.randomUUID() }
    }

    return client.create(input, createIntent.current.key)
  }

  const continued =
    !submitted && offset === 0 ? batches?.batches.find((batch) => !batch.archived) : undefined
  const resume = continued ? resumeAction(continued) : null
  const visible = batches?.batches.filter((batch) => batch.id !== continued?.id) ?? []
  const emptyMessage = submitted
    ? 'No retained batches match this title.'
    : 'No other visible batches. Show archived or create a batch.'
  return (
    <Inbox>
      <PageHead>
        <div>
          <Title>Batches</Title>
          <Lead>
            Photograph what's on the bench; we propose the stock lots and Parts for you to check.
          </Lead>
        </div>
        <Button variant="primary" icon="+" onClick={() => setCreating(true)}>
          New batch
        </Button>
      </PageHead>
      {(batchesQuery.isError || batchesQuery.fetchStatus === 'paused') && (
        <Banner
          tone="bad"
          action={
            <Button size="sm" onClick={() => void batchesQuery.refetch()}>
              Retry retained batches
            </Button>
          }
        >
          <span role="alert">Cannot load retained batches. Check the connection and retry.</span>
        </Banner>
      )}
      {(creating || (!submitted && offset === 0 && batches?.batches.length === 0)) && (
        <Card aria-labelledby="new-batch">
          <CardTitle id="new-batch">New batch</CardTitle>
          <NewBatchForm
            create={createBatch}
            onDirtyChange={reportDraftDirty}
            onDiscard={() => setCreating(false)}
          />
        </Card>
      )}
      {continued && (
        <ContinueCard aria-labelledby="continue-title">
          <ContinueImage>
            <BatchThumbnail batchId={continued.id} thumbnail={continued.workflow?.thumbnail} />
          </ContinueImage>
          <ContinueBody>
            <Eyebrow>Continue</Eyebrow>
            <CardTitle id="continue-title">{continued.title}</CardTitle>
            {continued.workflow ? (
              <>
                <Row>
                  {continued.workflow.open_questions > 0 && (
                    <Pill status="needs-answer">{continued.workflow.open_questions} need you</Pill>
                  )}
                  {continued.workflow.active_jobs > 0 && (
                    <Pill status="processing">Agents working</Pill>
                  )}
                  <Meta>Last saved {new Date(continued.updated_at).toLocaleString()}</Meta>
                </Row>
                <BatchCounts workflow={continued.workflow} />
              </>
            ) : (
              <Meta>Last saved {new Date(continued.updated_at).toLocaleString()}</Meta>
            )}
            <Actions>
              {resume && (
                <Button as="a" href={resume.href} variant="primary">
                  {resume.label}
                </Button>
              )}
              {continued.workflow &&
                continued.workflow.ready > 0 &&
                resume?.label.startsWith('Open') && (
                  <Button
                    as="a"
                    href={batchHref(
                      continued.id,
                      { tab: 'review', view: 'lots' },
                      '?filter=reviewed',
                    )}
                  >
                    Review {continued.workflow.ready} ready{' '}
                    {continued.workflow.ready === 1 ? 'lot' : 'lots'}
                  </Button>
                )}
            </Actions>
          </ContinueBody>
        </ContinueCard>
      )}
      <ListCard aria-labelledby="retained-batches">
        <ListHead>
          <ListLabel id="retained-batches">All batches · {visible.length}</ListLabel>
          <SearchForm
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              setOffset(0)
              setSubmitted(search.trim())
            }}
          >
            <label>
              <SearchInput
                type="search"
                aria-label="Search retained batches"
                value={search}
                maxLength={256}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a batch by title"
              />
            </label>
            <Button type="submit" size="sm">
              Search
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch('')
                setSubmitted('')
                setOffset(0)
              }}
            >
              Clear search
            </Button>
          </SearchForm>
          <ArchiveToggle>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked)
                setOffset(0)
              }}
            />
            Show archived
          </ArchiveToggle>
        </ListHead>
        {!batches && batchesQuery.isError ? null : !batches ? (
          <Note role="status">Loading retained batches…</Note>
        ) : !visible.length ? (
          <Note>{emptyMessage}</Note>
        ) : (
          <BatchList>
            {visible.map((b) => (
              <li key={b.id}>
                <BatchRow
                  href={batchHref(b.id, { tab: 'capture' })}
                  aria-label={b.title}
                  aria-describedby={`${b.id}-meta ${b.id}-state`}
                >
                  <BatchThumbnail batchId={b.id} thumbnail={b.workflow?.thumbnail} />
                  <RowText>
                    <strong aria-hidden="true">{b.title}</strong>
                    <Meta id={`${b.id}-meta`}>
                      {b.archived ? 'Archived · ' : ''}
                      {b.workflow
                        ? `${b.workflow.lots} ${b.workflow.lots === 1 ? 'lot' : 'lots'} · `
                        : ''}
                      {new Date(b.updated_at).toLocaleString()}
                    </Meta>
                  </RowText>
                  <RowState id={`${b.id}-state`}>
                    <BatchState workflow={b.workflow} />
                    <AddedBar workflow={b.workflow} />
                  </RowState>
                </BatchRow>
              </li>
            ))}
          </BatchList>
        )}
        {(offset > 0 || batches?.truncated) && (
          <Pagination aria-label="Batch pages">
            <Button
              size="sm"
              disabled={offset === 0 || batchesQuery.isFetching}
              onClick={() => setOffset((value) => Math.max(0, value - INBOX_PAGE_SIZE))}
            >
              Previous batches
            </Button>
            <Meta>Page {offset / INBOX_PAGE_SIZE + 1}</Meta>
            <Button
              size="sm"
              disabled={!batches?.truncated || batchesQuery.isFetching || offset >= 999990}
              onClick={() => setOffset((value) => value + INBOX_PAGE_SIZE)}
            >
              Next batches
            </Button>
          </Pagination>
        )}
        <Footnote>
          Search covers every retained batch title. Counts are saved observations; open a batch to
          check current choices.
        </Footnote>
      </ListCard>
    </Inbox>
  )
}

const Inbox = styled.section`
  display: grid;
  gap: ${space[9]};
  max-width: ${pageWidth.content};
  margin: 0 auto;
`

const PageHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${space[6]};
`

const Title = styled.h1`
  margin: 0;
  ${type.h1}
`

const Lead = styled.p`
  margin: ${space[2]} 0 0;
  color: ${color.muted};
`

const Card = styled.section`
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  min-width: 0;
`

const CardTitle = styled.h2`
  margin: 0;
  ${type.h2}
  overflow-wrap: anywhere;
`

const ContinueCard = styled(Card)`
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  overflow: hidden;
  padding: 0;
  ${media.compact} {
    grid-template-columns: 96px minmax(0, 1fr);
  }
`

/** The batch's first photo, flush to the card's edge. */
const ContinueImage = styled.div`
  --thumbnail-width: 100%;
  --thumbnail-height: 100%;
  min-height: 180px;
  > div {
    border: 0;
    border-radius: 0;
  }
  ${media.compact} {
    min-height: 0;
  }
`

const ContinueBody = styled.div`
  display: grid;
  align-content: center;
  gap: ${space[5]};
  min-width: 0;
  padding: ${space[8]} ${space[9]};
`

const Eyebrow = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Meta = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const ListCard = styled(Card)`
  padding: 0;
  overflow: hidden;
`

const ListHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]} ${space[6]};
  padding: ${space[5]} ${space[7]};
  border-bottom: 1px solid ${color.line};
`

const ListLabel = styled.h2`
  margin: 0 auto 0 0;
  ${type.label}
  color: ${color.muted};
`

const SearchForm = styled.form`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  label {
    min-width: 200px;
  }
`

const SearchInput = styled(Input)`
  min-height: ${size.control};
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const ArchiveToggle = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${space[3]};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const BatchList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  li + li {
    border-top: 1px solid ${color.line};
  }
`

/** The whole row opens the batch; its title names the link and the rest describes it. */
const BatchRow = styled.a`
  --thumbnail-width: 72px;
  --thumbnail-height: 54px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space[7]};
  padding: ${space[6]} ${space[7]};
  color: inherit;
  text-decoration: none;
  ${hoverTransition}
  &:hover {
    background: ${color.surface2};
  }
  strong {
    overflow-wrap: anywhere;
  }
  ${media.compact} {
    grid-template-columns: auto minmax(0, 1fr);
    > :last-child {
      grid-column: 2;
      justify-items: start;
    }
  }
`

const RowText = styled.span`
  display: grid;
  gap: ${space[1]};
  min-width: 0;
`

const RowState = styled.span`
  display: grid;
  justify-items: end;
  gap: ${space[3]};
`

const Pagination = styled.nav`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  padding: ${space[6]} ${space[7]};
  border-top: 1px solid ${color.line};
`

const Note = styled.p`
  margin: 0;
  padding: ${space[6]} ${space[7]};
  color: ${color.muted};
`

const Footnote = styled.p`
  margin: 0;
  padding: ${space[6]} ${space[7]};
  border-top: 1px solid ${color.line};
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
