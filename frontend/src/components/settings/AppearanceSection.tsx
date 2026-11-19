import { SettingRow } from '#/components/ui'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'
import { MastheadChoice } from './MastheadChoice'
import { ThemeChoice } from './ThemeChoice'

/** Settings › Appearance: the theme and where the masthead's electronics live, both stored on this device. */
export function AppearanceSection() {
  return (
    <SettingsSection title="Appearance" lead="How the app looks on this device.">
      <SettingsCard aria-label="Appearance">
        <SettingRow label="Theme" help="System follows your device's light or dark setting.">
          {({ named }) => <ThemeChoice labelledBy={named['aria-labelledby']} />}
        </SettingRow>
        <SettingRow label="Masthead" help="Where the drifting electronics sit.">
          {({ named }) => <MastheadChoice labelledBy={named['aria-labelledby']} />}
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  )
}
