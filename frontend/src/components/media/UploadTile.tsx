import { useRef } from 'react'
import styled from 'styled-components'
import { color, radius, ring, space, typeVar } from '#/theme/generated/tokens'
import { Button, Spinner } from '#/components/ui'
import type { UploadItem, UploadQueue } from '#/media/useUploadQueue'

type Props = {
  item: UploadItem
  /** Retry and Read again wait for a current read; Dismiss never sends anything. */
  disabled: boolean
  queue: Pick<UploadQueue, 'retry' | 'readAgain' | 'dismiss'>
}

function statusText(item: UploadItem) {
  switch (item.status) {
    case 'waiting':
    case 'uploading':
      return 'Uploading…'
    case 'preparing':
    case 'done':
      return 'Preparing…'
    case 'not_added':
      return `Not added. ${item.reason ?? ''}`.trim()
    case 'unconfirmed':
      return 'Upload not confirmed. Retry sends the same request, so it cannot be added twice.'
    case 'unread':
      return 'Added. The current evidence could not be read; read it again rather than uploading.'
    case 'ungrouped':
      return 'Added to Ungrouped. Moving it into its group was not confirmed.'
  }
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled)'

/**
 * Where focus goes once this tile is dismissed: the next tile's control, else the previous one's,
 * else the group region that held it, so focus never falls back to the page.
 */
function focusAfterDismiss(tile: HTMLElement | null): HTMLElement | null {
  const neighbour = tile?.nextElementSibling ?? tile?.previousElementSibling
  const sibling = neighbour?.querySelector<HTMLElement>(FOCUSABLE)
  if (sibling) {
    return sibling
  }
  const region = tile?.parentElement?.closest<HTMLElement>('section[aria-label]')
  if (!region) {
    return null
  }
  // A region is not a tab stop; -1 lets it hold focus without adding one.
  region.tabIndex = -1
  return region
}

/**
 * A picked file in its target group's grid. fetch reports no byte progress, so uploading is
 * indeterminate. Files already in their group are shown by their evidence tile instead.
 */
export function UploadTile({ item, disabled, queue }: Props) {
  const tile = useRef<HTMLDivElement>(null)

  if (item.status === 'done') {
    return null
  }

  const working = ['waiting', 'uploading', 'preparing'].includes(item.status)
  const failed = item.status === 'not_added' || item.status === 'unconfirmed'

  // The tile stays while its file is sent again, so focus waits on it instead of the vanished button.
  function retry() {
    tile.current?.focus()
    queue.retry(item.id)
  }

  function readAgain() {
    tile.current?.focus()
    queue.readAgain(item.id)
  }

  function dismiss() {
    const next = focusAfterDismiss(tile.current)
    queue.dismiss(item.id)
    next?.focus()
  }

  return (
    <Tile ref={tile} role="group" aria-label={`Upload of ${item.name}`} tabIndex={-1}>
      <Stage aria-hidden="true">{working ? <Spinner size={16} /> : <Glyph>▧</Glyph>}</Stage>
      <Caption>
        <Name title={item.name}>{item.name}</Name>
        <Status $failed={failed}>{statusText(item)}</Status>
        {item.status === 'unconfirmed' && (
          <Button size="sm" disabled={disabled} aria-label={`Retry ${item.name}`} onClick={retry}>
            Retry
          </Button>
        )}
        {item.status === 'unread' && (
          <Button
            size="sm"
            disabled={disabled}
            aria-label={`Read ${item.name} again`}
            onClick={readAgain}
          >
            Read again
          </Button>
        )}
        {(item.status === 'not_added' || item.status === 'ungrouped') && (
          <Button size="sm" variant="ghost" aria-label={`Dismiss ${item.name}`} onClick={dismiss}>
            Dismiss
          </Button>
        )}
      </Caption>
    </Tile>
  )
}

const Tile = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px dashed ${color.lineStrong};
  border-radius: ${radius.input};
  background: ${color.surface};
  &:focus-visible {
    outline: ${ring.width} solid ${color.accent};
    outline-offset: ${ring.offset};
  }
`
const Stage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  background: ${color.photoStage};
  color: ${color.photoFg};
`
const Glyph = styled.span`
  font-size: ${typeVar.pill.size};
`
const Caption = styled.div`
  display: grid;
  justify-items: start;
  gap: ${space[2]};
  padding: ${space[3]};
  min-width: 0;
`
const Name = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: ${typeVar.pill.size};
  line-height: ${typeVar.pill.lineHeight};
  font-weight: ${typeVar.bodyStrong.weight};
`
const Status = styled.span<{ $failed: boolean }>`
  font-size: ${typeVar.pill.size};
  line-height: ${typeVar.pill.lineHeight};
  overflow-wrap: anywhere;
  color: ${({ $failed }) => ($failed ? color.bad : color.muted)};
`
