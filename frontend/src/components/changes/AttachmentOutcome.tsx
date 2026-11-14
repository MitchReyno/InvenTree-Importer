import styled from 'styled-components'
import { color, space } from '#/theme/generated/tokens'
import type { ManualRunDto } from '@invimport/contracts'
import { Paragraph, Small, Button } from '#/components/ui'

type Attachment = NonNullable<ManualRunDto['attachments']>[number]

interface Props {
  attachment: Attachment
  busy: boolean
  recover: () => void
}

export function AttachmentOutcome({ attachment, busy, recover }: Props) {
  let status = 'No attachment effect is confirmed.'
  if (attachment.certainty === 'confirmed') {
    status = `Attachment #${attachment.remote_pk} was verified against its approved bytes and stock destination.`
  } else if (attachment.certainty === 'unknown') {
    status = 'Attachment may exist. Verify its content and destination before any further decision.'
  }
  return (
    <AttachmentRow>
      <strong>
        {attachment.lot_label} · {attachment.kind} attachment
      </strong>
      <Paragraph>{status}</Paragraph>
      {attachment.verification === 'missing_or_changed' && (
        <Paragraph role="status">
          The latest inspection found missing or changed content. Historical effects remain
          retained; this does not authorize replacement or another stock record.
        </Paragraph>
      )}
      <Small>
        {attachment.byte_size} bytes · SHA-256 {attachment.blob_sha256}
      </Small>
      {attachment.recovery_action && (
        <Button disabled={busy} onClick={recover}>
          {attachment.recovery_action === 'verify_attachment'
            ? `Verify original attachment: ${attachment.lot_label}`
            : `Repair original attachment: ${attachment.lot_label}`}
        </Button>
      )}
    </AttachmentRow>
  )
}

const AttachmentRow = styled.div`
  display: grid;
  gap: ${space[5]};
  padding: ${space[8]} 0;
  border-top: 1px solid ${color.line};
  overflow-wrap: anywhere;
  button {
    justify-self: start;
  }
`
