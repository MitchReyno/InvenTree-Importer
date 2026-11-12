import { useQuery } from '@tanstack/react-query'
import styled from 'styled-components'
import { space } from '#/theme/generated/tokens'
import type { CaptureSnapshotDto, MediaEvidenceDto } from '@invimport/contracts'
import { Banner, Button, Dialog, Paragraph, Small } from '#/components/ui'
import { useServerScope } from '#/context'
import { serverQueryKey } from '#/queries/scope'
import type { MediaClient } from '#/media/types'
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
  onConfirm: () => void
  onClose: () => void
  returnFocus: () => HTMLElement | null
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
  })
  if (!several) {
    return { impact: itemImpact(items[0]), failed: false, refetch: undefined }
  }
  const impact: RemovalImpact | undefined = query.isSuccess ? query.data : undefined

  return { impact, failed: query.isError, refetch: () => void query.refetch() }
}

/** Confirms a delete, naming the lots it touches, any left with no evidence and cleared choices. */
export function RemovalDialog({
  batch,
  client,
  items,
  revision,
  name,
  busy,
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
                {joinNames(bareLots)} will have no other evidence. Review will warn about{' '}
                {bareLots.length === 1 ? 'it' : 'them'}; nothing is left out.
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
        <Actions>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="warn" disabled={busy || !impact} onClick={onConfirm}>
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
