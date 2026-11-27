import { useId, useState } from 'react'
import styled from 'styled-components'
import type {
  MediaEditDto,
  MediaSnapshotDto,
  ProcessingImageCropDto,
  ProcessingImageSelectionDto,
  ProcessingImagesProposalDto,
  SessionInboxReceiptDto,
  SessionInboxSubmissionDto,
} from '@invimport/contracts'
import { MEDIA_STOCK_IMAGES_MAX } from '@invimport/contracts'
import {
  Banner,
  Button,
  Link,
  Pill,
  Small,
  Subheading,
  media as breakpoints,
} from '#/components/ui'
import { CheckboxLabel, Fieldset } from '#/forms'
import type { MediaClient } from '#/media/types'
import { batchHref, sessionPageHref } from '#/navigation/batch-route'
import { reportDirty, type DirtyReport, type UnsavedChange } from '#/navigation/unsaved-changes'
import { useReportDirty } from '#/navigation/useReportDirty'
import { failureMessage, type CommandFailure } from '#/operator/command-failure'
import { useRetainedCommand } from '#/operator/useRetainedCommand'
import {
  confirmedElsewhere,
  confirmedPlacement,
  defaultChoices,
  redoMessage,
  selectImagesChange,
  tooManyStockImages,
  unseenChosen,
  type ImageChoices,
} from '#/processing/images-review'
import { color, space } from '#/theme/generated/tokens'
import { ImagesCropCard, type CropControl } from './ImagesCropCard'
import { ImagesRedoForm, type RedoDraft } from './ImagesRedoForm'

/** Sends a chat message to a session, named by its job. */
export type SendChat = (
  jobId: string,
  input: SessionInboxSubmissionDto,
  key: string,
) => Promise<SessionInboxReceiptDto>

/** How Confirm reaches the media, and how a confirmed receipt is taken in. */
export type ImagesMedia = {
  client: MediaClient
  /** Shows the receipt and reads the media and the review again. */
  accept: (next: MediaSnapshotDto) => Promise<void>
}

/** A gate on the review read the section shows: why a command waits, and the check at dispatch. */
export type ReadGate = {
  waitReason?: string
  readyNow: () => boolean
}

/** The lot's Images session chat, for "Ask Images to redo one". */
export type ImagesChat = ReadGate & { send: SendChat }

type Props = {
  batchId: string
  /** The lot's newest proposal in the current read. */
  proposal: ProcessingImagesProposalDto
  selection: ProcessingImageSelectionDto | undefined
  /** The media revision the current read was taken at. */
  mediaRevision: string
  lotLabel: string
  /** Confirm needs a review read verified for this mount, neither failed nor paused. */
  review: ReadGate
  media?: ImagesMedia
  chat?: ImagesChat
  /** Why nothing can be sent, such as an archived batch. */
  closedReason?: string
  onChoicesDirty?: DirtyReport
  onRedoDirty?: DirtyReport
}

/** The read the operator's choices were made on: its proposal and its media revision. */
type Basis = { proposal: ProcessingImagesProposalDto; mediaRevision: string }

type RedoRequest = { jobId: string; text: string }

function confirmFailureText(failure: CommandFailure) {
  if (failure.kind === 'conflict') {
    return 'Capture changed since these were shown. Your choices are kept and weren’t applied.'
  }
  if (failure.kind === 'uncertain') {
    return 'The confirmation isn’t certain. Retry sends the same request, so it can’t apply twice.'
  }
  return failureMessage(failure)
}

function controlFor(
  crop: ProcessingImageCropDto,
  shown: ImageChoices,
  partName: string,
  onChoosePart: (index: number | null) => void,
  onToggleStock: (index: number, checked: boolean) => void,
): CropControl {
  if (crop.role === 'part_image') {
    return {
      kind: 'part',
      name: partName,
      checked: shown.partIndex === crop.index,
      onChoose: () => onChoosePart(crop.index),
    }
  }
  if (crop.role === 'stock_image') {
    return {
      kind: 'stock',
      checked: shown.stockIndexes.includes(crop.index),
      onToggle: (checked) => onToggleStock(crop.index, checked),
    }
  }
  return { kind: 'none' }
}

/**
 * One lot's Images review, kept for the lot's lifetime on the page. Choices, the redo draft and
 * unresolved requests stay here across newer reads; once the operator chooses, the proposal and
 * media revision they chose on are pinned until a confirmation lands or they let them go.
 */
export function ImagesProposalSection({
  batchId,
  proposal: current,
  selection,
  mediaRevision,
  lotLabel,
  review,
  media,
  chat,
  closedReason,
  onChoicesDirty,
  onRedoDirty,
}: Props) {
  const partName = useId()
  const [basis, setBasis] = useState<Basis | null>(null)
  // Null follows the defaults: the confirmed images, else the proposal's own choice.
  const [choices, setChoices] = useState<ImageChoices | null>(null)
  const [confirmedNow, setConfirmedNow] = useState(false)
  const [redoOpen, setRedoOpen] = useState(false)
  const [redoDraft, setRedoDraft] = useState<RedoDraft>({
    cropIndex: String(current.crops[0].index),
    change: '',
  })
  const [redoSent, setRedoSent] = useState(false)
  const command = useRetainedCommand((input: MediaEditDto, key: string) => {
    if (!media) {
      throw new Error('media_unconfigured')
    }
    return media.client.edit(batchId, input, key)
  })
  const redo = useRetainedCommand((request: RedoRequest, key: string) => {
    if (!chat) {
      throw new Error('chat_unavailable')
    }
    return chat.send(request.jobId, { idempotency_key: key, text: request.text }, key)
  })

  // The pinned proposal, refreshed from the read while it is still the newest.
  const pinnedProposal = basis?.proposal
  const proposal =
    pinnedProposal && pinnedProposal.proposal_id !== current.proposal_id ? pinnedProposal : current
  const newerProposal = proposal !== current
  const shown = choices ?? defaultChoices(proposal, selection)
  const locked = command.busy || command.pending
  const hasPartCrops = proposal.crops.some((crop) => crop.role === 'part_image')
  const elsewhere = confirmedElsewhere(proposal, selection)
  const unseen = unseenChosen(proposal, shown)
  const choicesLabel = `Images: ${lotLabel} · image choices`
  const caughtUp = basis !== null && basis.mediaRevision !== mediaRevision && !newerProposal

  /** Unconfirmed choices can be named and dropped; a request awaiting its outcome can't. */
  function namedChanges(next: ImageChoices | null, pending: boolean): UnsavedChange[] {
    return next !== null && !pending ? [{ label: choicesLabel, discard: handleDiscard }] : []
  }

  useReportDirty(
    choices !== null || command.pending,
    onChoicesDirty,
    namedChanges(choices, command.pending),
  )
  useReportDirty(redoDraft.change.trim() !== '' || redo.pending, onRedoDirty)

  let confirmClosedReason = closedReason
  if (!confirmClosedReason && !media) {
    confirmClosedReason = 'Retained media isn’t configured, so images can’t be confirmed here.'
  }
  if (!confirmClosedReason && tooManyStockImages(shown)) {
    confirmClosedReason = `Choose at most ${MEDIA_STOCK_IMAGES_MAX} stock images.`
  }
  if (!confirmClosedReason && unseen.length > 0) {
    const named = unseen.map((crop) => `crop ${crop.index}`).join(' and ')
    confirmClosedReason = `Untick ${named}: it isn’t rendered, so it can’t be confirmed.`
  }

  function reportChoices(next: ImageChoices | null, pending: boolean) {
    reportDirty(onChoicesDirty, next !== null || pending, namedChanges(next, pending))
  }

  function change(next: ImageChoices) {
    // The first choice pins the read it was made on; Confirm names that read's revision.
    if (basis === null) {
      setBasis({ proposal, mediaRevision })
    }
    setChoices(next)
    setConfirmedNow(false)
    reportChoices(next, command.hasPendingIntent())
  }

  function handleChoosePart(index: number | null) {
    change({ ...shown, partIndex: index })
  }

  function handleToggleStock(index: number, checked: boolean) {
    const others = shown.stockIndexes.filter((item) => item !== index)
    change({ ...shown, stockIndexes: checked ? [...others, index] : others })
  }

  function handleDiscard() {
    setBasis(null)
    setChoices(null)
    command.discard()
    reportChoices(null, false)
  }

  async function handleConfirm() {
    if (confirmClosedReason || !media || !review.readyNow()) {
      return
    }
    const confirmedOn = basis ?? { proposal, mediaRevision }
    // What is sent stays on screen, pinned, until it is confirmed or let go.
    setBasis(confirmedOn)
    setChoices(shown)
    setConfirmedNow(false)
    const input: MediaEditDto = {
      expected_revision: confirmedOn.mediaRevision,
      change: selectImagesChange(confirmedOn.proposal, shown),
    }
    const next = await command.submit(input)
    if (next === null) {
      reportChoices(shown, command.hasPendingIntent())
      return
    }
    // The defaults follow the confirmed images once both reads have them.
    await media.accept(next)
    setBasis(null)
    setChoices(null)
    setConfirmedNow(true)
    reportChoices(null, false)
  }

  function handleDiscardRequest() {
    command.discard()
    reportChoices(choices, false)
  }

  /** Keeps the choices, now checked against the latest read of the same proposal. */
  function handleReapply() {
    command.discard()
    setBasis({ proposal, mediaRevision })
  }

  function handleRedoDraft(next: RedoDraft) {
    setRedoDraft(next)
    setRedoSent(false)
    reportDirty(onRedoDirty, next.change.trim() !== '' || redo.hasPendingIntent(), [])
  }

  async function handleRedoSend() {
    if (closedReason || !chat || !chat.readyNow()) {
      return
    }
    const crop =
      proposal.crops.find((item) => String(item.index) === redoDraft.cropIndex) ?? proposal.crops[0]
    setRedoSent(false)
    // A pending request is retried exactly; a new one names this proposal's session.
    const receipt = await redo.submit({
      jobId: proposal.job_id,
      text: redoMessage(crop, redoDraft.change),
    })
    if (receipt === null) {
      reportDirty(onRedoDirty, redoDraft.change.trim() !== '' || redo.hasPendingIntent(), [])
      return
    }
    setRedoDraft({ ...redoDraft, change: '' })
    setRedoSent(true)
    reportDirty(onRedoDirty, false, [])
  }

  function handleRedoDiscard() {
    redo.discard()
    reportDirty(onRedoDirty, redoDraft.change.trim() !== '', [])
  }

  return (
    <Section aria-labelledby={`${partName}-heading`}>
      <Header>
        <Title>
          <Subheading id={`${partName}-heading`}>Images: {lotLabel}</Subheading>
          <Small>{proposal.summary}</Small>
        </Title>
        {proposal.stale && (
          <Pill tone="warn" glyph="!">
            Out of date: the lot changed since this was proposed
          </Pill>
        )}
        <Button as="a" size="sm" href={sessionPageHref(batchId, 'images', proposal.job_id)}>
          Open session
        </Button>
      </Header>
      {newerProposal && (
        <Banner
          tone="warn"
          action={
            <Button size="sm" disabled={locked} onClick={handleDiscard}>
              Show the newer proposal
            </Button>
          }
        >
          Images has proposed newer crops for this lot. These are the crops your choices were made
          on; showing the newer proposal drops your choices.
        </Banner>
      )}
      <Fieldset>
        <Legend>Choose the Part image and stock images</Legend>
        {hasPartCrops && (
          <CheckboxLabel>
            <input
              type="radio"
              name={partName}
              checked={shown.partIndex === null}
              disabled={locked || closedReason !== undefined}
              onChange={() => handleChoosePart(null)}
            />
            No Part image
          </CheckboxLabel>
        )}
        <Grid>
          {proposal.crops.map((crop) => (
            <ImagesCropCard
              key={crop.index}
              batchId={batchId}
              proposalId={proposal.proposal_id}
              crop={crop}
              placement={confirmedPlacement(crop, selection)}
              control={controlFor(crop, shown, partName, handleChoosePart, handleToggleStock)}
              disabled={locked || closedReason !== undefined}
            />
          ))}
        </Grid>
      </Fieldset>
      {elsewhere > 0 && (
        <Muted>
          {elsewhere === 1
            ? 'One confirmed image isn’t among these crops; confirming replaces it.'
            : `${elsewhere} confirmed images aren’t among these crops; confirming replaces them.`}
        </Muted>
      )}
      {command.failure && <Failure role="alert">{confirmFailureText(command.failure)}</Failure>}
      <Actions>
        <Button
          variant="primary"
          busy={command.busy}
          disabledReason={confirmClosedReason ?? review.waitReason}
          reasonDisplay={confirmClosedReason ? 'beside' : 'quiet'}
          onClick={() => void handleConfirm()}
        >
          {command.pending ? 'Retry confirm' : 'Confirm images'}
        </Button>
        {command.pending && !command.busy && (
          <Button onClick={handleDiscardRequest}>Discard request</Button>
        )}
        {command.failure?.kind === 'conflict' && caughtUp && (
          <Button onClick={handleReapply}>Check my choices against the latest</Button>
        )}
        {choices !== null && !locked && (
          <Button variant="ghost" onClick={handleDiscard}>
            Reset choices
          </Button>
        )}
        {chat && (
          <Button aria-expanded={redoOpen} onClick={() => setRedoOpen((open) => !open)}>
            Ask Images to redo one
          </Button>
        )}
        <Link href={batchHref(batchId, { tab: 'capture' })}>Crop it yourself in Capture</Link>
      </Actions>
      <Small role="status" aria-label="Images confirmation">
        {confirmedNow ? 'Confirmed.' : ''}
      </Small>
      {chat && !redoOpen && redo.pending && (
        <Muted>A redo request isn’t confirmed yet. Open it to retry or discard it.</Muted>
      )}
      {chat && redoOpen && (
        <ImagesRedoForm
          proposal={proposal}
          draft={redoDraft}
          onDraftChange={handleRedoDraft}
          pending={redo.pending}
          busy={redo.busy}
          failure={redo.failure}
          sent={redoSent}
          waitReason={chat.waitReason}
          closedReason={closedReason}
          onSend={() => void handleRedoSend()}
          onDiscard={handleRedoDiscard}
          onClose={() => setRedoOpen(false)}
        />
      )}
      <Muted>
        Each crop is the app’s rendering of the agent’s recipe from the original, so it can be
        recreated exactly. Nothing is attached until you confirm.
      </Muted>
    </Section>
  )
}

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space[6]};
  margin-bottom: ${space[10]};
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[5]};
`

const Title = styled.div`
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  ${Subheading} {
    margin: 0;
  }
  ${Small} {
    color: ${color.muted};
  }
`

const Legend = styled.legend`
  padding: 0;
  color: ${color.muted};
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space[7]};
  ${breakpoints.stacked} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  ${breakpoints.narrow} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[5]};
`

const Muted = styled(Small)`
  color: ${color.muted};
`

const Failure = styled.p`
  margin: 0;
  color: ${color.bad};
`
