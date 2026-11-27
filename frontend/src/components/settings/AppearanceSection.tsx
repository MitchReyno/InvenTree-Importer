import styled from 'styled-components'
import { SettingRow } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'
import { MastheadChoice } from './MastheadChoice'
import { MastheadMotionSwitch } from './MastheadMotionSwitch'
import { ThemeChoice } from './ThemeChoice'

/**
 * Settings › Appearance: the theme, where the masthead's electronics live and whether they move,
 * all stored on this device.
 */
export function AppearanceSection() {
  return (
    <SettingsSection title="Appearance" lead="How the app looks on this device.">
      <SettingsCard aria-label="Appearance">
        <SettingRow label="Theme" help="System follows your device's light or dark setting.">
          {({ named }) => <ThemeChoice labelledBy={named['aria-labelledby']} />}
        </SettingRow>
        <SettingRow label="Masthead" help="Where the drifting electronics sit.">
          {({ named }) => (
            <MastheadOptions>
              <MastheadChoice labelledBy={named['aria-labelledby']} />
              <MastheadMotionSwitch />
            </MastheadOptions>
          )}
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  )
}

const MastheadOptions = styled.div`
  display: grid;
  gap: ${space[6]};
`
