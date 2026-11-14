/** Application pages routed before batches; Settings also takes a section (`settings/inventree`). */
export type AppPage = 'settings' | 'agents'

export const SETTINGS_SECTIONS = [
  'agents',
  'inventree',
  'defaults',
  'descriptions',
  'appearance',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]

export function appPage(route: string | undefined): AppPage | undefined {
  if (route === 'agents') {
    return 'agents'
  }
  if (route === 'settings' || route?.startsWith('settings/')) {
    return 'settings'
  }

  return undefined
}

/** The Settings section a route opens; a bare or unknown section opens Agents. */
export function settingsSection(route: string): SettingsSectionId {
  const section = route.split('/')[1]
  const known = SETTINGS_SECTIONS.find((id) => id === section)

  return known ?? 'agents'
}

/** The batch a route opens, or none for the batch list and application pages. */
export function routeBatchId(route: string | undefined) {
  if (!route || appPage(route)) {
    return undefined
  }

  return route.split('/')[0] || undefined
}
