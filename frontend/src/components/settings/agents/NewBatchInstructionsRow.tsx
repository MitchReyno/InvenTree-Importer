import { SettingRow } from '#/components/ui'
import { TextArea } from '#/forms'

/** Instructions copied into every new batch, which the app can't store yet. */
export function NewBatchInstructionsRow() {
  return (
    <SettingRow
      label="Instructions for every new batch"
      help="Copied into a new batch's instructions, where you can change them."
      disabledReason="Not available yet: write instructions in each batch's Capture › Batch settings."
    >
      {({ named, disabled }) => <TextArea rows={3} readOnly {...named} {...disabled} />}
    </SettingRow>
  )
}
