import { useState } from 'react'
import styled from 'styled-components'
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
      ) : (
        <span>{thumbnail ? 'Preview unavailable' : 'Notes / known values'}</span>
      )}
    </Frame>
  )
}

const Frame = styled.div`
  width: var(--thumbnail-size, 84px);
  height: var(--thumbnail-size, 84px);
  flex-shrink: 0;
  border: 1px solid #d5dce5;
  border-radius: 5px;
  background: #eef2f7;
  overflow: hidden;
  display: grid;
  place-items: center;
  span {
    padding: 8px;
    font-size: 12px;
    text-align: center;
    color: #526179;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`
