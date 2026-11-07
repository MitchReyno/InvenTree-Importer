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
          src={mediaResource(batchId, 'previews', thumbnail.preview_id)}
          alt={thumbnail.label}
          loading="lazy"
          onError={() => setFailed(thumbnail.preview_id)}
        />
      ) : null}
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
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`
