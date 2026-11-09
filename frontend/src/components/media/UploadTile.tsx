import { useLayoutEffect, useRef } from 'react'
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
 * else the group region holding it, which takes focus without being a tab stop.
 */
function focusAfterDismiss(tile: HTMLElement | null): HTMLElement | null {
  const next = tile?.nextElementSibling?.querySelector<HTMLElement>(FOCUSABLE)
  const previous = tile?.previousElementSibling?.querySelector<HTMLElement>(FOCUSABLE)
  return (
    next ?? previous ?? tile?.parentElement?.closest<HTMLElement>('section[tabindex="-1"]') ?? null
  )
}

/**
 * A picked file in its target group's grid. fetch reports no byte progress, so uploading is
 * indeterminate. A file that reached its group leaves the queue and shows as its evidence tile.
 */
export function UploadTile({ item, disabled, queue }: Props) {
  const tile = useRef<HTMLDivElement>(null)

  // DOM focus: a tile that leaves while focused (its file added, or its notice overtaken by a read)
  // hands focus to its group region. A layout cleanup runs before the tile is removed.
  useLayoutEffect(() => {
    const node = tile.current
    return () => {
      if (node?.contains(document.activeElement)) {
        node.closest<HTMLElement>('section[tabindex="-1"]')?.focus()
      }
    }
  }, [])

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
        {/* Refusals interrupt; progress and settled outcomes are announced politely. */}
        {/* Keyed by role, so a change of role mounts a fresh live region that is announced. */}
        <Status
          key={failed ? 'alert' : 'status'}
          $failed={failed}
          role={failed ? 'alert' : 'status'}
        >
          {statusText(item)}
        </Status>
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
