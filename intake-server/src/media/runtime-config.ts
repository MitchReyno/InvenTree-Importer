/** Explicit local intake configuration only. No environment-file or credential discovery. */
export function mediaRuntimeConfig(environment: NodeJS.ProcessEnv) {
  const databaseUrl = environment.INTAKE_DATABASE_URL
  const blobRoot = environment.INTAKE_BLOB_ROOT
  if (!databaseUrl || !blobRoot?.trim()) {
    throw new Error('explicit_media_runtime_configuration_required')
  }
  const destination = new URL(databaseUrl)
  if (
    !['postgres:', 'postgresql:'].includes(destination.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(destination.hostname)
  ) {
    throw new Error('local_intake_database_required')
  }
  return { databaseUrl, blobRoot }
}
