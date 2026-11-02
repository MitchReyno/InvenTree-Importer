import type { ManualPartAttachmentDto } from '@invimport/contracts'
import { Field, Paragraph, Small, Summary } from '../ui/primitives'

export function PreparedPartAttachments({
  attachments,
}: {
  attachments: ManualPartAttachmentDto[]
}) {
  if (!attachments.length) {
    return null
  }
  return (
    <>
      <Paragraph>
        <strong>Selected Part file attachments · {attachments.length}</strong>
      </Paragraph>
      {attachments.map((attachment) => (
        <Field key={attachment.artifact_key}>
          <strong>{attachment.part_label}</strong>
          <Small>
            {attachment.part_id === null ? 'New shared Part output' : `Part #${attachment.part_id}`}{' '}
            ·{' '}
            {attachment.kind === 'original'
              ? 'Original retained evidence'
              : 'Selected retained derivative'}
          </Small>
          <Small>
            {attachment.prior_remote_pk
              ? `Reuse original attachment #${attachment.prior_remote_pk}; no upload is authorized`
              : 'Create a generic file attachment; keep the primary image unchanged'}
          </Small>
          <details>
            <Summary>Exact selected file and destination</Summary>
            <Small>Version {attachment.version_id}</Small>
            <Small>SHA-256 {attachment.blob_sha256}</Small>
            <Small>
              {attachment.byte_size} bytes · {attachment.media_type}
            </Small>
            {attachment.prior_run_id && <Small>Original run {attachment.prior_run_id}</Small>}
          </details>
        </Field>
      ))}
    </>
  )
}
