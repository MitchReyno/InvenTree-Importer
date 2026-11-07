import { Input, linkTouchArea } from '../ui/primitives'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { media } from '../ui/media'
import { useEffect, useRef, useState } from 'react'
import { NewBatchForm } from './NewBatchForm'
import { BatchWorkflow } from './BatchWorkflow'
import { BatchThumbnail } from './BatchThumbnail'
import type { InboxWorkflowDto, CaptureListQueryDto } from '@invimport/contracts'
import type { CaptureList } from '../../../../contracts/generated/api.d.ts'
import { BatchStageLinks } from './BatchStageLinks'
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
          <BatchThumbnail batchId={continued.id} thumbnail={continued.workflow?.thumbnail} />
          <ContinueBody>
            <Eyebrow>Continue</Eyebrow>
            <CardTitle id="continue-title">{continued.title}</CardTitle>
            <Meta>Last saved {new Date(continued.updated_at).toLocaleString()}</Meta>
            <BatchWorkflow batchId={continued.id} workflow={continued.workflow} />
            <Actions>
              {resume && (
                <Button as="a" href={resume.href} variant="primary">
                  {resume.label}
                </Button>
              )}
              <BatchStageLinks batchId={continued.id} title={continued.title} />
            </Actions>
          </ContinueBody>
        </ContinueCard>
      )}
      <Card aria-labelledby="retained-batches">
        <ListHead>
          <CardTitle id="retained-batches">All batches</CardTitle>
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
                <BatchThumbnail batchId={b.id} thumbnail={b.workflow?.thumbnail} />
                <BatchIdentity>
                  <a href={batchHref(b.id, { tab: 'capture' })}>
                    <strong>{b.title}</strong>
                  </a>
                  <Meta>
                    {b.archived ? 'Archived · ' : ''}
                    {new Date(b.updated_at).toLocaleString()}
                  </Meta>
                  <BatchWorkflow batchId={b.id} workflow={b.workflow} />
                </BatchIdentity>
                <BatchStageLinks batchId={b.id} title={b.title} />
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
      </Card>
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
  --thumbnail-size: 200px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: ${space[9]};
  align-items: center;
  ${media.compact} {
    --thumbnail-size: 76px;
    gap: ${space[6]};
    align-items: start;
  }
`

const ContinueBody = styled.div`
  display: grid;
  gap: ${space[5]};
  min-width: 0;
`

const Eyebrow = styled.span`
  ${type.label}
  color: ${color.accent};
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

const ListHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]} ${space[6]};
  margin-bottom: ${space[4]};
  ${CardTitle} {
    margin-right: auto;
  }
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
  --thumbnail-size: 56px;
  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: ${space[7]};
    padding: ${space[6]} 0;
    border-top: 1px solid ${color.line};
  }
  ${media.compact} {
    li {
      grid-template-columns: auto minmax(0, 1fr);
    }
    li > nav {
      grid-column: 1 / -1;
    }
  }
`

const BatchIdentity = styled.div`
  display: grid;
  gap: ${space[1]};
  min-width: 0;
  > a {
    color: ${color.fg};
    text-decoration: none;
    overflow-wrap: anywhere;
    ${linkTouchArea}
  }
  > a:hover {
    text-decoration: underline;
  }
`

const Pagination = styled.nav`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  padding-top: ${space[6]};
  border-top: 1px solid ${color.line};
`

const Note = styled.p`
  margin: ${space[6]} 0;
  color: ${color.muted};
`

const Footnote = styled.p`
  margin: ${space[6]} 0 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
