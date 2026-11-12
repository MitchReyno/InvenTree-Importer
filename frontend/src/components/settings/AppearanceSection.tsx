import { SettingRow } from '#/components/ui'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'
import { ThemeChoice } from './ThemeChoice'

/** Settings › Appearance: the theme, stored as the app's theme preference. */
export function AppearanceSection() {
  return (
    <SettingsSection title="Appearance" lead="How the app looks on this device.">
      <SettingsCard aria-label="Appearance">
        <SettingRow label="Theme" help="System follows your device's light or dark setting.">
          {({ named }) => <ThemeChoice labelledBy={named['aria-labelledby']} />}
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  )
}
