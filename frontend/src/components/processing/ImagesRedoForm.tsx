import { useId, type FormEvent } from 'react'
import styled from 'styled-components'
import type { ProcessingImagesProposalDto } from '@invimport/contracts'
import { Button, Small } from '#/components/ui'
import { Form, Label, Select, TextArea } from '#/forms'
import type { CommandFailure } from '#/operator/command-failure'
import { cropSourceLine, ROLE_LABEL } from '#/processing/images-review'
import { color, radius, space } from '#/theme/generated/tokens'

/**
 * A redo draft as its lot keeps it, so closing the form or a newer read never drops it. It names
 * the proposal it was started on, whose session and crop it asks about, until retargeted.
 */
export type RedoDraft = {
  target: ProcessingImagesProposalDto
  cropIndex: string
  change: string
  /** The operator has changed the crop, the text or the target since the draft started. */
  edited: boolean
}

type Props = {
  draft: RedoDraft
  /** Moves the draft to the lot's newer proposal; absent while the draft's proposal is newest. */
  onRetarget?: () => void
  onDraftChange: (draft: RedoDraft) => void
  /** A request awaiting its outcome: the form is locked to it until Retry or Discard. */
  pending: boolean
  busy: boolean
  failure: CommandFailure | null
  sent: boolean
  /** Why sending waits, quietly, such as a read still landing. */
  waitReason?: string
  /** Why sending is closed, such as an archived batch. */
  closedReason?: string
  onSend: () => void
  onDiscard: () => void
  /** Drops an edited draft that hasn't been sent. */
  onDiscardDraft: () => void
  onClose: () => void
}

/** Matches the chat's message limit, less room for the sentence naming the crop. */
const MAX_CHANGE_CHARACTERS = 3500

function failureText(failure: CommandFailure) {
  if (failure.kind === 'uncertain') {
    return 'Couldn’t send for certain. Retry sends the same request, so Images gets it once.'
  }
  return 'Couldn’t send: the session didn’t accept it. It may have finished; open the session to check.'
}

/** Asks the lot's Images session to redo one crop, naming it and, optionally, what to change. */
export function ImagesRedoForm({
  draft,
  onRetarget,
  onDraftChange,
  pending,
  busy,
  failure,
  sent,
  waitReason,
  closedReason,
  onSend,
  onDiscard,
  onDiscardDraft,
  onClose,
}: Props) {
  const fieldId = useId()
  const locked = busy || pending

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSend()
  }

  return (
    <RedoForm aria-label="Ask Images to redo a crop" onSubmit={handleSubmit}>
      {onRetarget && (
        <Notice>
          <Small>
            This request is written for the earlier proposal, so it goes to that proposal’s session.
          </Small>
          {!locked && (
            <Button size="sm" onClick={onRetarget}>
              Use the newer proposal
            </Button>
          )}
        </Notice>
      )}
      <Pair>
        <Label htmlFor={`${fieldId}-crop`}>Crop</Label>
        <Select
          id={`${fieldId}-crop`}
          value={draft.cropIndex}
          disabled={locked}
          onChange={(event) => onDraftChange({ ...draft, cropIndex: event.target.value })}
        >
          {draft.target.crops.map((item) => (
            <option key={item.index} value={String(item.index)}>
              Crop {item.index} · {ROLE_LABEL[item.role]} · {cropSourceLine(item)}
            </option>
          ))}
        </Select>
      </Pair>
      <Pair>
        <Label htmlFor={`${fieldId}-change`}>What to change (optional)</Label>
        <TextArea
          id={`${fieldId}-change`}
          value={draft.change}
          maxLength={MAX_CHANGE_CHARACTERS}
          disabled={locked}
          placeholder="Such as: keep the whole label in frame"
          onChange={(event) => onDraftChange({ ...draft, change: event.target.value })}
        />
      </Pair>
      {failure && <Failure role="alert">{failureText(failure)}</Failure>}
      <Actions>
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabledReason={closedReason ?? waitReason}
          reasonDisplay={closedReason ? 'beside' : 'quiet'}
        >
          {pending ? 'Retry' : 'Send to Images'}
        </Button>
        {pending && !busy && <Button onClick={onDiscard}>Discard request</Button>}
        {draft.edited && !locked && (
          <Button variant="ghost" onClick={onDiscardDraft}>
            Discard draft
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </Actions>
      <Small role="status" aria-label="Redo request">
        {sent ? 'Sent to Images. Its reply shows in the session.' : ''}
      </Small>
    </RedoForm>
  )
}

const RedoForm = styled(Form)`
  padding: ${space[6]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Notice = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Pair = styled.div`
  display: grid;
  gap: ${space[2]};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Failure = styled.p`
  margin: 0;
  color: ${color.bad};
`
