import { SettingRow, Switch } from '#/components/ui'

/** Whether new batches start with Auto tags on, which the app can't store yet. */
export function TagSuggestionsRow() {
  return (
    <SettingRow
      label="Suggest tags automatically"
      help="New batches start with Auto tags on. Each batch can change it in Capture › Batch settings."
      disabledReason="Not available yet: set Auto tags for each batch in Capture › Batch settings."
    >
      {({ disabled }) => (
        <Switch
          label="Suggest tags for new batches"
          checked={false}
          onChange={() => {}}
          {...disabled}
        />
      )}
    </SettingRow>
  )
}
