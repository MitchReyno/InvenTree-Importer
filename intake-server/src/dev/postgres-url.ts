function postgresUrl(address: string): URL {
  const url = new URL(address)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('plain_development_postgres_url_required')
  }
  return url
}

/** pg query parameters can override the authority parsed by URL. Accept plain URLs only. */
export function developmentAdminUrl(address: string): URL {
  const url = postgresUrl(address)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/postgres') {
    throw new Error('owned_local_admin_required')
  }
  url.hostname = '127.0.0.1'
  return url
}

export function developmentRuntimeUrl(address: string, databaseName: string): URL {
  const url = postgresUrl(address)
  if (
    url.hostname !== '127.0.0.1' ||
    url.pathname !== `/${databaseName}` ||
    !/^intake_[a-z0-9_]+$/.test(url.username)
  ) {
    throw new Error('owned_dev_database_required')
  }
  return url
}
