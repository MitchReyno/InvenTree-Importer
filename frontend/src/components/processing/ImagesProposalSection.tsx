import { useId, useState } from 'react'
import styled from 'styled-components'
import type {
  MediaEditDto,
  MediaSnapshotDto,
  ProcessingImageCropDto,
  ProcessingImageSelectionDto,
  ProcessingImagesProposalDto,
} from '@invimport/contracts'
import { MEDIA_STOCK_IMAGES_MAX } from '@invimport/contracts'
import { Button, Link, Pill, Small, Subheading, media as breakpoints } from '#/components/ui'
import { CheckboxLabel } from '#/forms'
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
  selectImagesChange,
  tooManyStockImages,
  type ImageChoices,
} from '#/processing/images-review'
import { color, space } from '#/theme/generated/tokens'
import { ImagesCropCard, type CropControl } from './ImagesCropCard'
import { ImagesRedoForm, type SendChat } from './ImagesRedoForm'

/** The media read Confirm sends at, and how a confirmed receipt is taken in. */
export type ImagesMedia = {
  client: MediaClient
  /** Why Confirm waits, quietly, such as the media read still landing. */
  waitReason?: string
  readyNow: () => boolean
  /** The media revision in the cache when Confirm is pressed. */
  revisionNow: () => string | undefined
  /** Shows the receipt and reads the media and the review again. */
  accept: (next: MediaSnapshotDto) => Promise<void>
}

/** The lot's Images session chat, for "Ask Images to redo one". */
export type ImagesChat = {
  send: SendChat
  waitReason?: string
  readyNow: () => boolean
}

type Props = {
  batchId: string
  proposal: ProcessingImagesProposalDto
  selection: ProcessingImageSelectionDto | undefined
  lotLabel: string
  media?: ImagesMedia
  chat?: ImagesChat
  /** Why nothing can be sent, such as an archived batch. */
  closedReason?: string
  onChoicesDirty?: DirtyReport
  onRedoDirty?: DirtyReport
}

function confirmFailureText(failure: CommandFailure) {
  if (failure.kind === 'conflict') {
    return 'Capture changed since these were shown. Your choices are kept; check them and confirm again.'
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
 * One lot's newest Images proposal: its crops to confirm as the Part image and stock images, a
 * redo request to the session, or cropping in Capture. Nothing is attached until Confirm.
 */
export function ImagesProposalSection({
  batchId,
  proposal,
  selection,
  lotLabel,
  media,
  chat,
  closedReason,
  onChoicesDirty,
  onRedoDirty,
}: Props) {
  const partName = useId()
  // Null follows the defaults: the confirmed images, else the proposal's own choice.
  const [choices, setChoices] = useState<ImageChoices | null>(null)
  const [confirmedNow, setConfirmedNow] = useState(false)
  const [redoOpen, setRedoOpen] = useState(false)
  const command = useRetainedCommand((input: MediaEditDto, key: string) => {
    if (!media) {
      throw new Error('media_unconfigured')
    }
    return media.client.edit(batchId, input, key)
  })
  const shown = choices ?? defaultChoices(proposal, selection)
  const locked = command.busy || command.pending
  const hasPartCrops = proposal.crops.some((crop) => crop.role === 'part_image')
  const elsewhere = confirmedElsewhere(proposal, selection)
  const choicesLabel = `Images: ${lotLabel} · image choices`

  /** Unconfirmed choices can be named and dropped; a request awaiting its outcome can't. */
  function namedChanges(next: ImageChoices | null, pending: boolean): UnsavedChange[] {
    return next !== null && !pending ? [{ label: choicesLabel, discard: handleDiscard }] : []
  }

  useReportDirty(
    choices !== null || command.pending,
    onChoicesDirty,
    namedChanges(choices, command.pending),
  )

  let confirmClosedReason = closedReason
  if (!confirmClosedReason && !media) {
    confirmClosedReason = 'Retained media isn’t configured, so images can’t be confirmed here.'
  }
  if (!confirmClosedReason && tooManyStockImages(shown)) {
    confirmClosedReason = `Choose at most ${MEDIA_STOCK_IMAGES_MAX} stock images.`
  }

  function reportChoices(next: ImageChoices | null, pending: boolean) {
    reportDirty(onChoicesDirty, next !== null || pending, namedChanges(next, pending))
  }

  function change(next: ImageChoices) {
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
    setChoices(null)
    reportChoices(null, command.hasPendingIntent())
  }

  async function handleConfirm() {
    if (confirmClosedReason || !media || !media.readyNow()) {
      return
    }
    const revision = media.revisionNow()
    if (!revision) {
      return
    }
    setConfirmedNow(false)
    const input: MediaEditDto = {
      expected_revision: revision,
      change: selectImagesChange(proposal, shown),
    }
    const next = await command.submit(input)
    if (next === null) {
      reportChoices(choices, command.hasPendingIntent())
      return
    }
    // The defaults follow the confirmed images once both reads have them.
    await media.accept(next)
    setChoices(null)
    setConfirmedNow(true)
    reportChoices(null, false)
  }

  function handleDiscardRequest() {
    command.discard()
    reportChoices(choices, false)
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
          disabledReason={confirmClosedReason ?? media?.waitReason}
          reasonDisplay={confirmClosedReason ? 'beside' : 'quiet'}
          onClick={() => void handleConfirm()}
        >
          {command.pending ? 'Retry confirm' : 'Confirm images'}
        </Button>
        {command.pending && !command.busy && (
          <Button onClick={handleDiscardRequest}>Discard request</Button>
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
      {chat && redoOpen && (
        <ImagesRedoForm
          proposal={proposal}
          send={chat.send}
          waitReason={chat.waitReason}
          readyNow={chat.readyNow}
          closedReason={closedReason}
          onDirtyChange={onRedoDirty}
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
