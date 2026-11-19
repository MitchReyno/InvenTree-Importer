import styled from 'styled-components'
import { SettingRow } from '#/components/ui'
import { Select } from '#/forms'
import { space } from '#/theme/generated/tokens'

const STEPS = ['Examine', 'Research', 'Images', 'Inventory']

/** A model for each step, which the app can't store yet. */
export function ModelPerStepRow() {
  return (
    <SettingRow
      label="Model per step"
      help="A lighter model for Images, the strongest for Examine."
      disabledReason="Not available yet: every step uses the model above."
    >
      {({ disabled }) => (
        <Steps>
          {STEPS.map((step) => (
            <label key={step}>
              {step}
              <Select defaultValue="same" {...disabled}>
                <option value="same">Same as above</option>
              </Select>
            </label>
          ))}
        </Steps>
      )}
    </SettingRow>
  )
}

const Steps = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[3]};
  label {
    gap: ${space[4]};
  }
`
