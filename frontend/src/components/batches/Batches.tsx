import { Banner, Button, media } from '#/components/ui'
import { Input } from '#/forms'
import { useEffect, useRef, useState } from 'react'
import { NewBatchForm } from './NewBatchForm'
import { BatchRow } from './BatchRow'
import type { InboxBatch } from './batchState'
import { Card, CardTitle } from './Card'
import { ContinueCard } from './ContinueCard'
import type { CaptureListQueryDto } from '@invimport/contracts'
import type { BatchCreate } from '@invimport/contracts/api'
import type { Client } from '#/capture/client'
import styled from 'styled-components'
import { color, pageWidth, size, space, type, typeVar } from '#/theme/generated/tokens'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '#/queries/scope'

interface BatchesClient extends Omit<Client, 'list'> {
  list: (query?: CaptureListQueryDto) => Promise<{ batches: InboxBatch[]; truncated: boolean }>
}
interface Props {
  client: BatchesClient
  onDirtyChange: (dirty: boolean) => void
}

const INBOX_PAGE_SIZE = 10

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
      {continued && <ContinueCard batch={continued} />}
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
                <BatchRow batch={b} />
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

const Meta = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
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
