import styled from 'styled-components'
import type { ManualPreviewDto } from '@invimport/contracts'
import { Heading, Paragraph, Small, Summary } from '../ui/primitives'
import { mediaResource } from '../../media/types'

export function PreparedMediaEffects({ preview }: { preview: ManualPreviewDto }) {
  if (!preview.attachments) {
    return null
  }
  return (
    <section aria-labelledby="prepared-attachments-title">
      <Heading id="prepared-attachments-title">
        Attach selected files · {preview.attachments.length}
      </Heading>
      {preview.attachments.map((attachment) => (
        <Attachment key={attachment.artifact_key}>
          <strong>{attachment.evidence_label}</strong>
          <Paragraph>
            {attachment.kind === 'original' ? 'Unchanged original' : 'Prepared documentary crop'} →
            attachment on the new stock record for {attachment.lot_label}.
          </Paragraph>
          <a href={mediaResource(preview.batch_id, 'versions', attachment.version_id)} download>
            Download exact selected file
          </a>
          <Small>
            {attachment.byte_size} bytes · {attachment.media_type}
          </Small>
          <details>
            <Summary>Selected bytes and source provenance</Summary>
            <Paragraph>SHA-256 {attachment.blob_sha256}</Paragraph>
            <Paragraph>Original SHA-256 {attachment.original_sha256}</Paragraph>
            {attachment.recipe_sha256 && (
              <Paragraph>Recipe SHA-256 {attachment.recipe_sha256}</Paragraph>
            )}
          </details>
        </Attachment>
      ))}
      {!preview.attachments.length && (
        <Paragraph>No file attachment is included in this prepared scope.</Paragraph>
      )}
      <details>
        <Summary>Retained supporting evidence · {preview.evidence?.length ?? 0} versions</Summary>
        {preview.evidence?.map((evidence) => (
          <Attachment key={evidence.version_id}>
            <a href={mediaResource(preview.batch_id, 'versions', evidence.version_id)} download>
              Download retained {evidence.kind}
            </a>
            <Small>
              {evidence.byte_size} bytes · SHA-256 {evidence.blob_sha256}
            </Small>
          </Attachment>
        ))}
      </details>
    </section>
  )
}

const Attachment = styled.div`
  display: grid;
  gap: 8px;
  padding: 14px 0;
  border-top: 1px solid #e0e5ed;
  overflow-wrap: anywhere;
`
