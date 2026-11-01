import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { CaptureSnapshotDto, ManualWorkspaceDto } from '@invimport/contracts'
import { Button, Heading, Panel, Paragraph, Small, Link, Notice, Field } from '../ui/primitives'
import { ReviewQueue } from './ReviewQueue'
import { display } from '../../capture/display'

interface Props {
  batch: CaptureSnapshotDto
  workspace: ManualWorkspaceDto
  selected: string[]
  busy: boolean
  stale: boolean
  toggle: (id: string) => void
  review: () => void
  prepare: () => void
}
export function ReviewWorkspace({
  batch,
  workspace,
  selected,
  busy,
  stale,
  toggle,
  review,
  prepare,
}: Props) {
  const initial = location.hash.split('/')[2]
  const [focused, setFocused] = useState<string | null>(() =>
    batch.lots.some((value) => value.id === initial) ? initial : null,
  )
  const evidenceRef = useRef<HTMLElement>(null)
  const queueRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef(focused)
  useEffect(() => {
    if (focused) {
      evidenceRef.current?.focus({ preventScroll: true })
    } else if (previousFocus.current) {
      queueRef.current?.focus({ preventScroll: true })
    }
    previousFocus.current = focused
  }, [focused])
  const lot = batch.lots.find((value) => value.id === focused)
  const part = batch.parts.find((value) => value.id === lot?.part_subject_id)
  const partChoice = part?.choice.mode === 'set' ? part.choice.value : null
  const status = workspace.lots.find((value) => value.lot_id === lot?.id)
  const selectedStatus = workspace.lots.filter((value) => selected.includes(value.lot_id))
  const blocked = selectedStatus.some((value) => value.issues.length > 0)
  const reviewed =
    selected.length > 0 &&
    selectedStatus.length === selected.length &&
    selectedStatus.every((value) => value.reviewed)
  function inspect(id: string) {
    setFocused(id)
    history.replaceState(null, '', `#${batch.id}/review/${id}`)
  }
  const notes = batch.notes.filter(
    (value) =>
      value.subject_id === null || value.subject_id === lot?.id || value.subject_id === part?.id,
  )
  return (
    <>
      <ScopeBar>
        <div>
          <strong>{selected.length} selected</strong>
          <Small>{batch.lots.length - selected.length} remain outside this scope.</Small>
        </div>
        <Button disabled={busy || stale || blocked || !selected.length} onClick={review}>
          Mark selected reviewed
        </Button>
        <Button disabled={busy || stale || blocked || !reviewed} onClick={prepare}>
          Prepare exact selected effects
        </Button>
      </ScopeBar>
      {!workspace.supported && (
        <Notice>
          Stock execution is unavailable for this target. Only a separately configured owned fake is
          qualified; the real inventory stays read-only.
        </Notice>
      )}
      <ReviewGrid $focused={Boolean(lot)}>
        <QueueFocus ref={queueRef} tabIndex={-1} data-area="queue">
          <ReviewQueue
            batch={batch}
            workspace={workspace}
            selected={selected}
            focused={focused}
            busy={busy}
            toggle={toggle}
            inspect={inspect}
          />
        </QueueFocus>
        {lot && (
          <BackButton
            data-area="back"
            onClick={() => {
              setFocused(null)
              history.replaceState(null, '', `#${batch.id}/review`)
            }}
          >
            ← Physical lots and selection
          </BackButton>
        )}
        <Panel data-area="evidence" ref={evidenceRef} tabIndex={-1} aria-label="Human evidence">
          <Heading>Human evidence</Heading>
          <Small>
            Original notes are retained evidence. No automated inference or uploads are enabled.
          </Small>
          {lot ? (
            <>
              <Paragraph>
                <strong>{lot.label}</strong> · {part?.label ?? 'No shared Part chosen'}
              </Paragraph>
              {notes.map((note) => (
                <Field key={note.id}>
                  <strong>
                    {note.subject_id === null
                      ? 'Batch note'
                      : note.subject_id === part?.id
                        ? 'Shared Part note'
                        : 'Physical lot note'}
                  </strong>
                  <OriginalNote>{note.text || 'Empty original note'}</OriginalNote>
                  <Small>Human · {new Date(note.created_at).toLocaleString()}</Small>
                </Field>
              ))}
            </>
          ) : (
            <Paragraph>
              Inspect a physical lot to compare its retained evidence and saved choices.
            </Paragraph>
          )}
        </Panel>
        <Panel data-area="details">
          <Heading>{lot ? lot.label : 'Exact saved choices'}</Heading>
          {lot ? (
            <>
              <Field>
                <strong>Existing Part</strong>
                <Paragraph>
                  {partChoice
                    ? `${batch.observations.find((value) => value.id === partChoice.observation_id)?.label ?? 'Observed Part'} (#${partChoice.pk})`
                    : 'Not selected'}
                </Paragraph>
                <Small>{part?.label ?? 'No shared proposal'} · shared prerequisite only</Small>
              </Field>
              <Field>
                <strong>Quantity</strong>
                <Paragraph>{display(lot.quantity, batch, 'quantity')}</Paragraph>
              </Field>
              <Field>
                <strong>Location</strong>
                <Paragraph>{display(lot.location, batch, 'location')}</Paragraph>
              </Field>
              {status?.issues.map((problem, index) => (
                <Notice key={`${problem.code}:${index}`}>
                  {problem.message}
                  {problem.run_id && (
                    <>
                      <br />
                      <Link href={`#${batch.id}/results/${problem.run_id}`}>
                        Inspect original run
                      </Link>
                    </>
                  )}
                </Notice>
              ))}
              <Paragraph>
                {status?.reviewed
                  ? 'Reviewed exact current dependencies.'
                  : 'Review binds these saved choices and relevant human notes.'}
              </Paragraph>
              <Link href={`#${batch.id}/${lot.id}`}>Edit saved choices in Capture</Link>
            </>
          ) : (
            <Paragraph>
              Marking reviewed changes no inventory. Preparation performs bounded read-only checks,
              then freezes the selected effects.
            </Paragraph>
          )}
        </Panel>
      </ReviewGrid>
    </>
  )
}
const ScopeBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 12px 16px;
  background: white;
  border: 1px solid #d5dce5;
  border-radius: 6px;
  > div {
    margin-right: auto;
  }
`
const ReviewGrid = styled.div<{ $focused: boolean }>`
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(300px, 1.4fr) minmax(300px, 1.4fr);
  gap: 12px;
  align-items: start;
  @media (max-width: 1000px) {
    grid-template-columns: minmax(180px, 0.8fr) minmax(260px, 1.2fr);
    [data-area='evidence'] {
      grid-column: 2;
    }
    [data-area='details'] {
      grid-column: 2;
    }
    [data-area='queue'] {
      grid-column: 1;
      grid-row: 1/3;
    }
  }
  @media (max-width: 700px) {
    display: block;
    [data-area='queue'] {
      display: ${(p) => (p.$focused ? 'none' : 'block')};
    }
    [data-area='evidence'],
    [data-area='details'] {
      display: ${(p) => (p.$focused ? 'block' : 'none')};
    }
  }
`
const BackButton = styled(Button)`
  display: none;
  @media (max-width: 700px) {
    display: block;
    margin-bottom: 12px;
  }
`

const OriginalNote = styled(Paragraph)`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`
const QueueFocus = styled.div`
  min-width: 0;
`
