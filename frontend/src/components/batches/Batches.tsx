import { HeadingRow, Eyebrow, Intro, Caption, CheckboxLabel, Label, Small } from '../ui/primitives'
import { Button, Heading, Input, Link, PageTitle, Panel, Paragraph } from '../ui/primitives'
import { useEffect, useRef, useState } from 'react'
import { NewBatchForm } from './NewBatchForm'
import { BatchStageLinks } from './BatchStageLinks'
import type { BatchCreate } from '../../../../contracts/generated/api.d.ts'
import type { Client } from '../../capture/client'
import styled from 'styled-components'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '../../queries/scope'

export function Batches({
  client,
  onDirtyChange,
}: {
  client: Client
  onDirtyChange: (dirty: boolean) => void
}) {
  const scope = useServerScope()
  const batchesQuery = useQuery({
    queryKey: serverQueryKey(scope, 'batches'),
    queryFn: () => client.list(),
  })
  const batches = batchesQuery.data
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
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

  const recent = batches?.batches.find((b) => !b.archived)
  const query = search.trim().toLocaleLowerCase()
  const continued = query ? undefined : recent
  const visible =
    batches?.batches.filter(
      (batch) =>
        batch.id !== continued?.id &&
        (archived || !batch.archived) &&
        batch.title.toLocaleLowerCase().includes(query),
    ) ?? []
  let emptyMessage = 'No visible batches yet. Show archived or create a batch.'
  if (query) {
    emptyMessage = 'No loaded batches match this title.'
  } else if (continued) {
    emptyMessage = 'No other visible batches. Show archived or create a batch.'
  }
  return (
    <>
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
          Cannot load retained batches. Check capture database setup and retry.
        </Paragraph>
      )}
      {(creating || batches?.batches.length === 0) && (
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
          <Eyebrow>Continue your latest batch</Eyebrow>
          <Heading id="continue-title">{continued.title}</Heading>
          <Caption>
            Saved revision {continued.revision} · {new Date(continued.updated_at).toLocaleString()}
          </Caption>
          <BatchStageLinks batchId={continued.id} title={continued.title} />
        </ContinueCard>
      )}
      <Panel aria-labelledby="retained-batches">
        <HeadingRow>
          <Heading id="retained-batches">Retained batches</Heading>
          <CheckboxLabel>
            <Input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived
          </CheckboxLabel>
        </HeadingRow>
        <SearchLabel>
          Search loaded batches
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a batch by title"
          />
        </SearchLabel>
        <Small>
          Search covers the loaded list, up to the most recent 100 batches. Open a batch for current
          work and outcomes.
        </Small>
        {!batches ? (
          <Paragraph role="status">Loading retained batches…</Paragraph>
        ) : !visible.length ? (
          <Paragraph>{emptyMessage}</Paragraph>
        ) : (
          <BatchList>
            {visible.map((b) => (
              <li key={b.id}>
                <BatchIdentity>
                  <Link href={`#${b.id}/capture`}>
                    <strong>{b.title}</strong>
                  </Link>
                  <Small>
                    {b.archived ? 'Archived · ' : ''}Revision {b.revision} ·{' '}
                    {new Date(b.updated_at).toLocaleString()}
                  </Small>
                </BatchIdentity>
                <BatchStageLinks batchId={b.id} title={b.title} />
              </li>
            ))}
          </BatchList>
        )}
        {batches?.truncated && (
          <Paragraph role="status">
            Showing the most recent 100 batches. Older batches remain retained; direct batch links
            still resume them.
          </Paragraph>
        )}
      </Panel>
    </>
  )
}

const ContinueCard = styled(Panel)`
  border-left: 4px solid #3977c9;
  background: linear-gradient(110deg, #edf3fc, white 75%);
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
    border-top: 1px solid #e0e5ed;
  }
`
