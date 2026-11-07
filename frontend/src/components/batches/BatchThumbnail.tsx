import { useState } from 'react'
import styled from 'styled-components'
import { color, radius } from '../../theme/generated/tokens'
import type { InboxWorkflowDto } from '@invimport/contracts'
import { mediaResource } from '../../media/types'

export function BatchThumbnail({
  batchId,
  thumbnail,
}: {
  batchId: string
  thumbnail?: InboxWorkflowDto['thumbnail']
}) {
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <Frame>
      {thumbnail && failed !== thumbnail.preview_id ? (
        <img
          // The read model carries no dimensions; the fixed box only ever needs the thumb size.
          src={`${mediaResource(batchId, 'previews', thumbnail.preview_id)}?size=thumb`}
          alt={thumbnail.label}
          loading="lazy"
          onError={() => setFailed(thumbnail.preview_id)}
        />
      ) : (
        // No photo yet, or one that failed to load: a quiet glyph that still says which.
        <span role="img" aria-label={thumbnail ? 'Preview unavailable' : 'No photos yet'}>
          {thumbnail ? '⊘' : '✎'}
        </span>
      )}
    </Frame>
  )
}

const Frame = styled.div`
  width: var(--thumbnail-width, 84px);
  height: var(--thumbnail-height, 84px);
  flex-shrink: 0;
  border: 1px solid ${color.line};
  border-radius: ${radius.thumb};
  background: ${color.photoStage};
  overflow: hidden;
  display: grid;
  place-items: center;
  color: ${color.muted};
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`
