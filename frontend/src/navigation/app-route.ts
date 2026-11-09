/** Application pages routed before batches; Settings also takes a section (`settings/inventree`). */
export type AppPage = 'settings' | 'agents'

export function appPage(route: string | undefined): AppPage | undefined {
  if (route === 'agents') {
    return 'agents'
  }
  if (route === 'settings' || route?.startsWith('settings/')) {
    return 'settings'
  }

  return undefined
}

/** The batch a route opens, or none for the batch list and application pages. */
export function routeBatchId(route: string | undefined) {
  if (!route || appPage(route)) {
    return undefined
  }

  return route.split('/')[0] || undefined
}
