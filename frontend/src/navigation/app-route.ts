/** Application pages routed before batches; Settings also takes a section (`settings/inventree`). */
export type AppPage = 'settings' | 'agents'

export const SETTINGS_SECTIONS = [
  'agents',
  'inventree',
  'defaults',
  'appearance',
  'developer',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]

/** Settings › Agents subsections, each with its own route (`settings/agents/models`). */
export const AGENT_SUBSECTIONS = [
  'providers',
  'sessions',
  'models',
  'instructions',
  'descriptions',
  'tags',
  'research',
] as const

export type AgentSubsectionId = (typeof AGENT_SUBSECTIONS)[number]

// Descriptions and naming was its own section; its old link opens the Agents subsection.
const MOVED_TO_AGENTS: readonly AgentSubsectionId[] = ['descriptions']

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

/**
 * The Agents subsection a Settings route points at: `settings/agents/<subsection>`, or an old
 * section link that moved under Agents (`settings/descriptions`). None for any other route.
 */
export function settingsSubsection(route: string): AgentSubsectionId | undefined {
  const [, section, subsection] = route.split('/')
  const moved = MOVED_TO_AGENTS.find((id) => id === section)
  if (moved) {
    return moved
  }
  if (section !== 'agents') {
    return undefined
  }

  return AGENT_SUBSECTIONS.find((id) => id === subsection)
}

/** The batch a route opens, or none for the batch list and application pages. */
export function routeBatchId(route: string | undefined) {
  if (!route || appPage(route)) {
    return undefined
  }

  return route.split('/')[0] || undefined
}
