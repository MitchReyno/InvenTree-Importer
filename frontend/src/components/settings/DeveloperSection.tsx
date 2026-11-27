import { SettingRow, Switch } from '#/components/ui'
import { DevToolActions } from '#/components/operations/DevToolActions'
import { LocalSetup } from '#/components/operations/LocalSetup'
import { useDebugMode } from '#/debug/debug-mode'
import { useReadiness } from '#/debug/useReadiness'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'

/** Settings › Developer: debug mode, the local setup check and developer tools. */
export function DeveloperSection() {
  const { enabled, setEnabled } = useDebugMode()
  // The section is mounted only while open, so the check runs only then.
  const readiness = useReadiness(true)
  const failed = readiness.phase === 'failed'

  return (
    <SettingsSection
      title="Developer"
      lead="Tools for working on Bench Intake. Also in the Dev mode menu in the masthead."
    >
      <SettingsCard aria-label="Debug mode">
        <SettingRow
          label="Debug mode"
          help="Shows IDs, revisions, hashes and raw states across the app. Saved on this device."
        >
          <Switch label="Show debug details" checked={enabled} onChange={setEnabled} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard aria-label="Local setup">
        <SettingRow label="Local setup">
          <LocalSetup readiness={readiness} />
        </SettingRow>
        <SettingRow
          label="App data"
          help="Reload reads everything again from the server; unsaved edits are kept."
        >
          <DevToolActions readiness={failed ? 'unavailable' : readiness.data} />
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  )
}
