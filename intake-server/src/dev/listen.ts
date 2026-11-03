/** The public origin remains authoritative even when Vite forwards to a private API port. */
export function devListenPort(origin: string, env: NodeJS.ProcessEnv): number {
  const selected = env.INTAKE_DEV_LISTEN_PORT
  if (selected === undefined) {
    return Number(new URL(origin).port) || 80
  }
  if (!/^[1-9][0-9]{0,4}$/.test(selected) || Number(selected) > 65535) {
    throw new Error('invalid_dev_listen_port')
  }
  return Number(selected)
}
