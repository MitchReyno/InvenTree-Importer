import { HeadingRow, Eyebrow, Intro, Caption, CheckboxLabel } from '../ui/primitives'
import {
  Button,
  Form,
  Heading,
  Input,
  Label,
  Link,
  PageTitle,
  Panel,
  Paragraph,
  TextArea,
} from '../ui/primitives'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Client } from '../../capture/client'
import styled from 'styled-components'
export function Batches({ client }: { client: Client }) {
  const [batches, setBatches] = useState<Awaited<ReturnType<Client['list']>> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const createIntent = useRef({ payload: '', key: crypto.randomUUID() })
  useEffect(() => {
    let active = true
    void client
      .list()
      .then((value) => {
        if (active) {
          setBatches(value)
        }
      })
      .catch(() => {
        if (active) {
          setError('Cannot load retained batches. Check capture database setup and retry.')
        }
      })
    return () => {
      active = false
    }
  }, [client])
  const recent = batches?.batches.find((b) => !b.archived)
  const others =
    batches?.batches.filter((b) => (archived || !b.archived) && b.id !== recent?.id) ?? []
  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const input = { title: String(data.get('title')), note: String(data.get('note')) }
    const payload = JSON.stringify(input)
    if (createIntent.current.payload !== payload) {
      createIntent.current = { payload, key: crypto.randomUUID() }
    }
    setBusy(true)
    setError('')
    try {
      const batch = await client.create(input, createIntent.current.key)
      location.hash = batch.id
    } catch {
      setError(
        'Save could not be confirmed. Check the batch list before creating again; do not assume failure means nothing was saved.',
      )
    } finally {
      setBusy(false)
    }
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
      {error && <Paragraph role="alert">{error}</Paragraph>}
      {(creating || batches?.batches.length === 0) && (
        <Panel aria-labelledby="new-batch">
          <Heading id="new-batch">New batch</Heading>
          <Form
            onSubmit={(event) => {
              void createBatch(event)
            }}
          >
            <Label>
              Batch title
              <Input name="title" required maxLength={256} placeholder="Bench bag · November" />
            </Label>
            <Label>
              Human note
              <TextArea
                name="note"
                maxLength={8192}
                placeholder="Where these components came from; observations, not inferred facts"
              />
            </Label>
            <Button disabled={busy}>Create retained batch</Button>
          </Form>
        </Panel>
      )}
      {recent && (
        <Panel aria-labelledby="continue-title">
          <Eyebrow>Continue manual capture</Eyebrow>
          <Heading id="continue-title">{recent.title}</Heading>
          <Caption>
            Saved revision {recent.revision} · {new Date(recent.updated_at).toLocaleString()} · no
            inventory effects
          </Caption>
          <Link href={`#${recent.id}`}>Resume capture →</Link>
        </Panel>
      )}
      <Panel aria-labelledby="retained-batches">
        <HeadingRow>
          <Heading id="retained-batches">Resume a batch</Heading>
          <CheckboxLabel>
            <Input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived
          </CheckboxLabel>
        </HeadingRow>
        {!batches ? (
          <Paragraph role="status">Loading retained batches…</Paragraph>
        ) : !others.length ? (
          <Paragraph>
            {recent
              ? 'No other visible batches.'
              : 'No visible batches yet. Show archived or create a batch.'}
          </Paragraph>
        ) : (
          <BatchList>
            {others.map((b) => (
              <li key={b.id}>
                <Link href={`#${b.id}`}>
                  <strong>{b.title}</strong>
                  <span>
                    {b.archived ? 'Archived · ' : ''}Revision {b.revision} ·{' '}
                    {new Date(b.updated_at).toLocaleString()}
                  </span>
                </Link>
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

const BatchList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 14px 0 0;
  a {
    display: block;
    padding: 16px 4px;
    border-top: 1px solid #e0e5ed;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  span {
    display: block;
    color: #526179;
    font-size: 13px;
    margin-top: 7px;
  }
`
