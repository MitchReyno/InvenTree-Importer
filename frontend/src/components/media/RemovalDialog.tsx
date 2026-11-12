import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import type { CaptureSnapshotDto, MediaEvidenceDto } from '@invimport/contracts'
import { Banner, Button, Dialog, Paragraph, Small } from '#/components/ui'
import { useServerScope } from '#/context'
import { serverQueryKey } from '#/queries/scope'
import type { MediaClient } from '#/media/types'
import { shownVersion, thumbnailUrl } from '#/media/images'
import {
  attachmentLabel,
  itemImpact,
  joinNames,
  subjectLabel,
  type RemovalImpact,
} from '#/media/removal'

type Props = {
  batch: CaptureSnapshotDto
  client: MediaClient
  /** The files to delete, as the snapshot the dialog opened from shows them. */
  items: MediaEvidenceDto[]
  /** The media revision the delete is sent against. */
  revision: string
  name: (item: MediaEvidenceDto) => string
  /** A media command is being sent, this one or another. */
  busy: boolean
  /** Why Delete waits, such as an unread snapshot; shown here, since the page behind is inert. */
  waitReason: string | null
  onConfirm: () => void
  onClose: () => void
  returnFocus: () => HTMLElement | null
}

/** How many of several files the dialog pictures before saying how many more there are. */
const FILES_PICTURED = 4

const THUMBNAIL_PX = 64

function FileThumbnail({ batchId, item }: { batchId: string; item: MediaEvidenceDto }) {
  const version = shownVersion(item)
  const page = version?.state === 'ready' ? version.pages[0] : undefined

  return (
    <Thumbnail>
      {page && (
        <img
          src={thumbnailUrl(batchId, page.preview_id)}
          alt=""
          width={THUMBNAIL_PX}
          height={THUMBNAIL_PX}
        />
      )}
    </Thumbnail>
  )
}

/** The file being deleted, or the first few of several with a count of the rest. */
function FilesToDelete({
  batchId,
  items,
  name,
}: {
  batchId: string
  items: MediaEvidenceDto[]
  name: (item: MediaEvidenceDto) => string
}) {
  if (items.length === 1) {
    const [item] = items
    return (
      <File aria-label={name(item)}>
        <FileThumbnail batchId={batchId} item={item} />
        <FileName as="figcaption">{name(item)}</FileName>
      </File>
    )
  }
  const shown = items.slice(0, FILES_PICTURED)
  const more = items.length - shown.length

  return (
    <div>
      <Strip aria-label="Files to delete">
        {shown.map((item) => (
          <StripItem key={item.id}>
            <FileThumbnail batchId={batchId} item={item} />
            <FileName>{name(item)}</FileName>
          </StripItem>
        ))}
      </Strip>
      {more > 0 && <Small>and {more} more</Small>}
    </div>
  )
}

/**
 * Several files are read together, since a lot can lose its last evidence only to the set. One
 * file uses its own fields from the snapshot.
 */
function useRemovalImpact(
  batchId: string,
  client: MediaClient,
  items: MediaEvidenceDto[],
  revision: string,
) {
  const scope = useServerScope()
  const ids = items.map((item) => item.id)
  const several = items.length > 1
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'media-removal-impact', batchId, revision, ...ids),
    queryFn: () => client.removalImpact(batchId, ids),
    enabled: several,
    // The impact depends on capture state as well as media, so each opening reads it afresh.
    staleTime: 0,
    refetchOnMount: 'always',
  })
  if (!several) {
    return { impact: itemImpact(items[0]), failed: false, refetch: undefined }
  }
  // A cached result from an earlier opening never enables Delete; only this opening's read does.
  const fresh = query.isFetchedAfterMount && query.isSuccess && !query.isFetching
  const impact: RemovalImpact | undefined = fresh ? query.data : undefined

  return {
    impact,
    failed: query.isError && !query.isFetching,
    refetch: () => void query.refetch(),
  }
}

/** Confirms a delete, naming the lots it touches, any left with no evidence and cleared choices. */
export function RemovalDialog({
  batch,
  client,
  items,
  revision,
  name,
  busy,
  waitReason,
  onConfirm,
  onClose,
  returnFocus,
}: Props) {
  const { impact, failed, refetch } = useRemovalImpact(batch.id, client, items, revision)
  const single = items.length === 1
  const title = single ? `Delete ${name(items[0])}?` : `Delete ${items.length} files?`
  const confirmLabel = single ? 'Delete file' : `Delete ${items.length} files`
  const pronoun = single ? 'it' : 'them'
  const lots = impact?.lot_ids.map((id) => subjectLabel(batch, id)) ?? []
  const bareLots = impact?.sole_evidence_lot_ids.map((id) => subjectLabel(batch, id)) ?? []
  const cleared = impact?.selected_attachment_of ?? []

  return (
    <Dialog title={title} onClose={onClose} closeDisabled={busy} returnFocus={returnFocus}>
      <Body>
        <FilesToDelete batchId={batch.id} items={items} name={name} />
        <Paragraph>
          {single
            ? 'It leaves the batch and what agents read, and its note goes with it.'
            : 'They leave the batch and what agents read, and their notes go with them.'}{' '}
          You can restore {pronoun} from Deleted files.
        </Paragraph>
        {!impact && !failed && <Small role="status">Checking which lots use {pronoun}…</Small>}
        {failed && (
          <div role="alert">
            <Banner
              tone="bad"
              action={
                <Button size="sm" onClick={refetch}>
                  Check again
                </Button>
              }
            >
              Which lots use these files couldn’t be checked, so they can’t be deleted yet.
            </Banner>
          </div>
        )}
        {impact && (
          <>
            {lots.length ? (
              <section>
                <Small as="h3">Used by</Small>
                <List aria-label={`Lots that use ${pronoun}`}>
                  {lots.map((label, index) => (
                    <li key={impact.lot_ids[index]}>{label}</li>
                  ))}
                </List>
              </section>
            ) : (
              <Paragraph>No lot uses {pronoun}.</Paragraph>
            )}
            {bareLots.length > 0 && (
              <Banner tone="warn">
                {joinNames(bareLots)} will have no supporting evidence. Review will warn that no
                note or linked media supports {bareLots.length === 1 ? 'it' : 'them'}, a warning you
                can dismiss; {bareLots.length === 1 ? 'the lot isn’t' : 'the lots aren’t'} left out.
              </Banner>
            )}
            {cleared.length > 0 && (
              <section>
                <Small as="h3">Attachment choices cleared</Small>
                <List aria-label={`Attachment choices ${single ? 'it clears' : 'they clear'}`}>
                  {cleared.map((selection) => (
                    <li key={`${selection.subject_id}:${selection.destination}`}>
                      {attachmentLabel(batch, selection)}
                    </li>
                  ))}
                </List>
              </section>
            )}
          </>
        )}
        {waitReason && <Small role="status">{waitReason}</Small>}
        <Actions>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="warn"
            disabled={busy || waitReason !== null || !impact}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </Actions>
      </Body>
    </Dialog>
  )
}

const Body = styled.div`
  display: grid;
  gap: ${space[6]};
`

const File = styled.figure`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  margin: 0;
  min-width: 0;
`

const Strip = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
  margin: 0;
  padding: 0;
  list-style: none;
`

const StripItem = styled.li`
  display: grid;
  justify-items: start;
  gap: ${space[2]};
  max-width: ${THUMBNAIL_PX * 2}px;
  min-width: 0;
`

const Thumbnail = styled.span`
  display: grid;
  place-items: center;
  width: ${THUMBNAIL_PX}px;
  height: ${THUMBNAIL_PX}px;
  overflow: hidden;
  border-radius: ${radius.sm};
  background: ${color.photoStage};
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const FileName = styled.span`
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${typeVar.small.size};
`

const List = styled.ul`
  margin: ${space[2]} 0 0;
  padding-left: ${space[8]};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space[4]};
`
