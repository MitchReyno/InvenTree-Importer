import styled from 'styled-components'
import { SettingRow, Switch } from '#/components/ui'
import { Select } from '#/forms'
import { space } from '#/theme/generated/tokens'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'

const NOT_STORED = 'Not available yet: set this for each batch in Capture › Batch settings.'

/** Settings › Batch defaults: app-level defaults for new batches, which the app can't store yet. */
export function BatchDefaultsSection() {
  return (
    <SettingsSection
      title="Batch defaults"
      lead="New batches start with these. Each batch can change them in Capture › Batch settings."
    >
      <SettingsCard aria-label="Batch defaults">
        <SettingRow
          label="Default location"
          help="Where new stock goes unless a lot says otherwise."
          disabledReason={NOT_STORED}
        >
          {({ named, disabled }) => (
            <Select defaultValue="" {...named} {...disabled}>
              <option value="">No default location</option>
            </Select>
          )}
        </SettingRow>
        <SettingRow
          label="Default supplier"
          help="Leave empty for salvage and bench batches."
          disabledReason={NOT_STORED}
        >
          {({ named, disabled }) => (
            <Select defaultValue="" {...named} {...disabled}>
              <option value="">No supplier</option>
            </Select>
          )}
        </SettingRow>
        <SettingRow label="Tags" disabledReason={NOT_STORED}>
          {({ disabled }) => (
            <Column>
              <Switch
                label="Suggest tags automatically"
                checked={false}
                onChange={() => {}}
                {...disabled}
              />
              <Switch
                label="Tag every Part with its batch name"
                checked={false}
                onChange={() => {}}
                {...disabled}
              />
            </Column>
          )}
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  )
}

const Column = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[3]};
`
