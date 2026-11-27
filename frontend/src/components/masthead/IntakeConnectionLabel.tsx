import { useIntakeConnection } from '#/context'

export function IntakeConnectionLabel({ scopeFailed = false }: { scopeFailed?: boolean }) {
  const state = useIntakeConnection()
  if (!state) {
    return scopeFailed ? 'Intake service degraded' : 'Checking Intake…'
  }
  if (state.contact === 'checking') {
    return 'Checking Intake…'
  }
  if (state.contact === 'disconnected') {
    return 'No connection to Intake'
  }
  if (state.contact === 'degraded' || state.bootstrapFailed || scopeFailed) {
    return 'Intake responding, service degraded'
  }
  return 'Intake connected'
}
