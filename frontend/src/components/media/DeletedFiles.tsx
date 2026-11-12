import { useId, type Ref } from 'react'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import type { MediaRemovedEvidenceDto } from '@invimport/contracts'
import { Button, Small, Summary } from '#/components/ui'
import { thumbnailUrl } from '#/media/images'

type Props = {
  batchId: string
  removed: MediaRemovedEvidenceDto[]
  /** Each file's name, numbered as the tiles number files that share one. */
  names: ReadonlyMap<string, string>
  /** Why Restore waits, or null; a request being sent disables it without a reason. */
  restoreReason: string | null
  restoreDisabled: boolean
  onRestore: (item: MediaRemovedEvidenceDto) => void
  /** The disclosure's summary, which takes focus when an Undo is refused. */
  summaryRef?: Ref<HTMLElement>
}

const THUMBNAIL_PX = 48

/** Deleted photos and documents, each with its thumbnail, label and Restore. */
export function DeletedFiles({
  batchId,
  removed,
  names,
  restoreReason,
  restoreDisabled,
  onRestore,
  summaryRef,
}: Props) {
  const reasonId = useId()

  return (
    <details>
      <Summary ref={summaryRef}>Deleted files · {removed.length}</Summary>
      {restoreReason && <Small id={reasonId}>{restoreReason}</Small>}
      <List aria-label="Deleted files">
        {removed.map((item) => {
          const name = names.get(item.id) ?? item.label
          return (
            <Row key={item.id}>
              <Thumbnail>
                {item.preview_id && (
                  <img
                    src={thumbnailUrl(batchId, item.preview_id)}
                    alt=""
                    width={THUMBNAIL_PX}
                    height={THUMBNAIL_PX}
                    loading="lazy"
                  />
                )}
              </Thumbnail>
              <Name title={name}>{name}</Name>
              <Button
                size="sm"
                aria-label={`Restore ${name}`}
                aria-describedby={restoreReason ? reasonId : undefined}
                disabled={restoreDisabled}
                onClick={() => onRestore(item)}
              >
                Restore
              </Button>
            </Row>
          )
        })}
      </List>
    </details>
  )
}

const List = styled.ul`
  display: grid;
  gap: ${space[3]};
  margin: ${space[4]} 0 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  min-width: 0;
`

const Thumbnail = styled.span`
  flex: none;
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

const Name = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${typeVar.small.size};
`
