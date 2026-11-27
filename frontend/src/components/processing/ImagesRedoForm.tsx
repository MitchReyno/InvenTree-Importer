import { useId, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import type {
  ProcessingImagesProposalDto,
  SessionInboxReceiptDto,
  SessionInboxSubmissionDto,
} from '@invimport/contracts'
import { Button, Small } from '#/components/ui'
import { Form, Label, Select, TextArea } from '#/forms'
import { useReportDirty } from '#/navigation/useReportDirty'
import type { DirtyReport } from '#/navigation/unsaved-changes'
import type { CommandFailure } from '#/operator/command-failure'
import { useRetainedCommand } from '#/operator/useRetainedCommand'
import { cropSourceLine, redoMessage, ROLE_LABEL } from '#/processing/images-review'
import { color, radius, space } from '#/theme/generated/tokens'

export type SendChat = (
  jobId: string,
  input: SessionInboxSubmissionDto,
  key: string,
) => Promise<SessionInboxReceiptDto>

type Props = {
  proposal: ProcessingImagesProposalDto
  send: SendChat
  /** Why sending waits, quietly, such as a read still landing. */
  waitReason?: string
  /** The same test checked when pressed, against the read shown. */
  readyNow: () => boolean
  /** Why sending is closed, such as an archived batch. */
  closedReason?: string
  onDirtyChange?: DirtyReport
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
  proposal,
  send,
  waitReason,
  readyNow,
  closedReason,
  onDirtyChange,
  onClose,
}: Props) {
  const fieldId = useId()
  const [cropIndex, setCropIndex] = useState(String(proposal.crops[0].index))
  const [change, setChange] = useState('')
  const [sent, setSent] = useState(false)
  const command = useRetainedCommand((text: string, key: string) =>
    send(proposal.job_id, { idempotency_key: key, text }, key),
  )
  const crop = proposal.crops.find((item) => String(item.index) === cropIndex) ?? proposal.crops[0]
  const locked = command.busy || command.pending
  useReportDirty(change.trim() !== '' || command.pending, onDirtyChange)

  function handleChange(text: string) {
    setChange(text)
    setSent(false)
    onDirtyChange?.(text.trim() !== '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (closedReason || !readyNow()) {
      return
    }
    setSent(false)
    const receipt = await command.submit(redoMessage(crop, change))
    if (receipt === null) {
      onDirtyChange?.(change.trim() !== '' || command.hasPendingIntent())
      return
    }
    setChange('')
    setSent(true)
    onDirtyChange?.(false)
  }

  function handleDiscard() {
    command.discard()
    onDirtyChange?.(change.trim() !== '')
  }

  return (
    <RedoForm aria-label="Ask Images to redo a crop" onSubmit={(event) => void handleSubmit(event)}>
      <Pair>
        <Label htmlFor={`${fieldId}-crop`}>Crop</Label>
        <Select
          id={`${fieldId}-crop`}
          value={cropIndex}
          disabled={locked}
          onChange={(event) => {
            setCropIndex(event.target.value)
            setSent(false)
          }}
        >
          {proposal.crops.map((item) => (
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
          value={change}
          maxLength={MAX_CHANGE_CHARACTERS}
          disabled={locked}
          placeholder="Such as: keep the whole label in frame"
          onChange={(event) => handleChange(event.target.value)}
        />
      </Pair>
      {command.failure && <Failure role="alert">{failureText(command.failure)}</Failure>}
      <Actions>
        <Button
          type="submit"
          variant="primary"
          busy={command.busy}
          disabledReason={closedReason ?? waitReason}
          reasonDisplay={closedReason ? 'beside' : 'quiet'}
        >
          {command.pending ? 'Retry' : 'Send to Images'}
        </Button>
        {command.pending && !command.busy && (
          <Button onClick={handleDiscard}>Discard request</Button>
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
