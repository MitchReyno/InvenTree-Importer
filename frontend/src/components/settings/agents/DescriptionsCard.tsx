import { useId, type ReactNode } from 'react'
import styled from 'styled-components'
import { SettingRow, Switch } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import { SettingsCard } from '#/components/settings/SettingsCard'

const NOT_USED = "Not available yet: agents don't follow these rules, and nothing here is stored."

// InvenTree's description limits, as the records' description fields count them. Agents already
// write Part descriptions, so that switch shows on.
const RECORDS = [
  { label: 'Parts', limit: 250, on: true },
  { label: 'Companies', limit: 500, on: false },
  { label: 'Manufacturer parts', limit: 250, on: false },
  { label: 'Supplier parts', limit: 250, on: false },
  { label: 'Categories', limit: 250, on: false },
  { label: 'Locations', limit: 250, on: false },
  { label: 'Parameter templates', limit: 250, on: false },
]

const SUPPLIER_TEXT = [
  { id: 'supplier', label: "Copy the supplier's own text" },
  { id: 'part', label: 'Use the Part description' },
]

/** Settings › Agents › Descriptions and naming: the saved Part description style, then the rules still to come. */
export function DescriptionsCard({ style }: { style: ReactNode }) {
  const name = useId()

  return (
    <SettingsCard aria-label="Descriptions and naming">
      {style}
      <SettingRow label="Fill descriptions for" help="New records only." disabledReason={NOT_USED}>
        {({ disabled }) => (
          <Column>
            {RECORDS.map((record) => (
              <Switch
                key={record.label}
                label={`${record.label} · up to ${record.limit}`}
                checked={record.on}
                onChange={() => {}}
                {...disabled}
              />
            ))}
          </Column>
        )}
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
  )
}

const Column = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[3]};
`
