import styled from 'styled-components'
import { SettingRow, Switch } from '#/components/ui'
import { space } from '#/theme/generated/tokens'

/** Web research switches, which nothing controls yet. */
export function WebResearchRow() {
  return (
    <SettingRow
      label="Web research"
      help="Research reads public pages from an isolated browser."
      disabledReason="Not available yet: these switches aren't stored, so research is unchanged."
    >
      {({ disabled }) => (
        <Column>
          <Switch
            label="Allow public web pages"
            checked={false}
            onChange={() => {}}
            {...disabled}
          />
          <Switch
            label="Prefer manufacturer datasheets over distributor pages"
            checked={false}
            onChange={() => {}}
            {...disabled}
          />
        </Column>
      )}
    </SettingRow>
  )
}

const Column = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[3]};
`
