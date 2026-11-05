import { HeadingRow, Eyebrow, Intro, Caption, CheckboxLabel, Label, Small } from '../ui/primitives'
import { Button, Heading, Input, Link, PageTitle, Panel, Paragraph } from '../ui/primitives'
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
import { color } from '../../theme/generated/tokens'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'

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
      href: `#${batch.id}/processing/overview`,
      label: `Open ${batch.workflow.open_questions} questions`,
    }
  }
  if (batch.workflow?.lots) {
    return { href: `#${batch.id}/review`, label: `Review ${batch.workflow.lots} lots` }
  }
  return { href: `#${batch.id}/capture`, label: 'Continue Capture' }
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
      <HeadingRow>
        <div>
          <Eyebrow>Your bench, retained</Eyebrow>
          <PageTitle>Batches</PageTitle>
        </div>
        <Button onClick={() => setCreating(true)}>New batch</Button>
      </HeadingRow>
      <Intro>
        Start with a note or known values. Each packet stays a distinct physical lot, even when it
        shares a Part.
      </Intro>
      {(batchesQuery.isError || batchesQuery.fetchStatus === 'paused') && (
        <Paragraph role="alert">
          Cannot load retained batches. Check the connection and retry.
          <Button onClick={() => void batchesQuery.refetch()}>Retry retained batches</Button>
        </Paragraph>
      )}
      {(creating || (!submitted && offset === 0 && batches?.batches.length === 0)) && (
        <Panel aria-labelledby="new-batch">
          <Heading id="new-batch">New batch</Heading>
          <NewBatchForm
            create={createBatch}
            onDirtyChange={reportDraftDirty}
            onDiscard={() => setCreating(false)}
          />
        </Panel>
      )}
      {continued && (
        <ContinueCard aria-labelledby="continue-title">
          <BatchThumbnail batchId={continued.id} thumbnail={continued.workflow?.thumbnail} />
          <div>
            <Eyebrow>Continue your latest batch</Eyebrow>
            <Heading id="continue-title">{continued.title}</Heading>
            <Caption>
              Saved revision {continued.revision} ·{' '}
              {new Date(continued.updated_at).toLocaleString()}
            </Caption>
            <BatchWorkflow batchId={continued.id} workflow={continued.workflow} />
            {resume && <ResumeLink href={resume.href}>{resume.label}</ResumeLink>}
            <BatchStageLinks batchId={continued.id} title={continued.title} />
          </div>
        </ContinueCard>
      )}
      <Panel aria-labelledby="retained-batches">
        <HeadingRow>
          <Heading id="retained-batches">Retained batches</Heading>
          <CheckboxLabel>
            <Input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked)
                setOffset(0)
              }}
            />
            Show archived
          </CheckboxLabel>
        </HeadingRow>
        <SearchForm
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            setOffset(0)
            setSubmitted(search.trim())
          }}
        >
          <SearchLabel>
            Search retained batches
            <Input
              type="search"
              value={search}
              maxLength={256}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a batch by title"
            />
          </SearchLabel>
          <Button type="submit">Search</Button>
          <Button
            type="button"
            onClick={() => {
              setSearch('')
              setSubmitted('')
              setOffset(0)
            }}
          >
            Clear search
          </Button>
        </SearchForm>
        <Small>
          Searches all retained batch titles on the server. Workflow counts are saved observations;
          open a batch to verify current choices.
        </Small>
        {!batches && batchesQuery.isError ? null : !batches ? (
          <Paragraph role="status">Loading retained batches…</Paragraph>
        ) : !visible.length ? (
          <Paragraph>{emptyMessage}</Paragraph>
        ) : (
          <BatchList>
            {visible.map((b) => (
              <li key={b.id}>
                <BatchThumbnail batchId={b.id} thumbnail={b.workflow?.thumbnail} />
                <BatchIdentity>
                  <Link href={`#${b.id}/capture`}>
                    <strong>{b.title}</strong>
                  </Link>
                  <Small>
                    {b.archived ? 'Archived · ' : ''}Revision {b.revision} ·{' '}
                    {new Date(b.updated_at).toLocaleString()}
                  </Small>
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
              disabled={offset === 0 || batchesQuery.isFetching}
              onClick={() => setOffset((value) => Math.max(0, value - INBOX_PAGE_SIZE))}
            >
              Previous batches
            </Button>
            <Small>Page {offset / INBOX_PAGE_SIZE + 1}</Small>
            <Button
              disabled={!batches?.truncated || batchesQuery.isFetching || offset >= 999990}
              onClick={() => setOffset((value) => value + INBOX_PAGE_SIZE)}
            >
              Next batches
            </Button>
          </Pagination>
        )}
      </Panel>
    </Inbox>
  )
}

const ContinueCard = styled(Panel)`
  display: flex;
  gap: 22px;
  align-items: center;
  --thumbnail-size: 180px;
  > div:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  @media (max-width: 700px) {
    --thumbnail-size: 76px;
    gap: 12px;
    align-items: start;
  }

  border-left: 4px solid ${color.accent};
  background: linear-gradient(110deg, ${color.accentWeak}, ${color.surface} 75%);
  ${Eyebrow} {
    margin: 0 0 6px;
  }
  ${Caption} {
    margin: 6px 0;
  }
`
const SearchLabel = styled(Label)`
  max-width: 440px;
  margin: 6px 0;
`
const BatchIdentity = styled.div`
  min-width: 0;
  flex: 1;
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
`
const BatchList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 20px;
    padding: 8px 0;
    border-top: 1px solid ${color.line};
  }
`

const SearchForm = styled.form`
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
  label {
    flex: 1;
    min-width: 160px;
  }
`
const Pagination = styled.nav`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 14px;
`

const Inbox = styled.section`
  max-width: 1120px;
  margin: 0 auto;
`

const ResumeLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 9px 14px;
  margin-top: 6px;
  background: ${color.accentWeak};
  border: 1px solid ${color.lineStrong};
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
`
