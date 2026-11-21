import type { ManualPartAttachmentDto } from '@invimport/contracts'
import { DebugDetails, Paragraph, Small } from '#/components/ui'
import { Field } from '#/forms'

export function PartAttachments({ attachments }: { attachments: ManualPartAttachmentDto[] }) {
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
          <DebugDetails
            label="Exact selected file and destination"
            rows={[
              { label: 'Version', value: attachment.version_id },
              { label: 'SHA-256', value: attachment.blob_sha256 },
              { label: 'Bytes', value: attachment.byte_size },
              { label: 'Media type', value: attachment.media_type },
              ...(attachment.prior_run_id
                ? [{ label: 'Original run', value: attachment.prior_run_id }]
                : []),
            ]}
          />
        </Field>
      ))}
    </>
  )
}
