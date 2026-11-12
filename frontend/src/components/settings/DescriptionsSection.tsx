import { useId } from 'react'
import styled from 'styled-components'
import { SettingRow, Switch } from '#/components/ui'
import { TextArea } from '#/forms'
import { space } from '#/theme/generated/tokens'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'

const NOT_USED = "Not available yet: agents don't follow these rules, and nothing here is stored."

// InvenTree's description limits, as the records' description fields count them.
const RECORDS = [
  { label: 'Parts', limit: 250 },
  { label: 'Companies', limit: 500 },
  { label: 'Manufacturer parts', limit: 250 },
  { label: 'Supplier parts', limit: 250 },
  { label: 'Categories', limit: 250 },
  { label: 'Locations', limit: 250 },
  { label: 'Parameter templates', limit: 250 },
]

const SUPPLIER_TEXT = [
  { id: 'supplier', label: "Copy the supplier's own text" },
  { id: 'part', label: 'Use the Part description' },
]

/** Settings › Descriptions and naming: rules for agent-written descriptions, not stored yet. */
export function DescriptionsSection() {
  const name = useId()

  return (
    <SettingsSection
      title="Descriptions and naming"
      lead="How agents write the free-text fields InvenTree shows. Existing records keep their text unless you change it in Review."
    >
      <SettingsCard aria-label="Descriptions and naming">
        <SettingRow
          label="Fill descriptions for"
          help="New records only."
          disabledReason={NOT_USED}
        >
          {({ disabled }) => (
            <Column>
              {RECORDS.map((record) => (
                <Switch
                  key={record.label}
                  label={`${record.label} · up to ${record.limit}`}
                  checked={false}
                  onChange={() => {}}
                  {...disabled}
                />
              ))}
            </Column>
          )}
        </SettingRow>
        <SettingRow
          label="Part description style"
          help="A pattern agents follow, written in plain words."
          disabledReason={NOT_USED}
        >
          {({ named, disabled }) => <Style rows={3} readOnly {...named} {...disabled} />}
        </SettingRow>
        <SettingRow label="Supplier part descriptions" disabledReason={NOT_USED}>
          {({ named, disabled }) => (
            <Column role="radiogroup" {...named}>
              {SUPPLIER_TEXT.map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name={name}
                    value={option.id}
                    defaultChecked={false}
                    {...disabled}
                  />
                  {option.label}
                </label>
              ))}
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

const Style = styled(TextArea)`
  width: 100%;
`
