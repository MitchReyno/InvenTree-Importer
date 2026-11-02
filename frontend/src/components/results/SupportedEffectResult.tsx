import type { SupportedEffectResultDto } from '@invimport/contracts'
import { Button, Field, Paragraph, Small } from '../ui/primitives'

interface Props {
  effect: SupportedEffectResultDto
  busy: boolean
  recover: () => void
  unstarted?: boolean
}

export function SupportedEffectResult({ effect, busy, recover, unstarted = false }: Props) {
  const planned =
    unstarted &&
    effect.certainty === 'none' &&
    effect.remote_pks.length === 0 &&
    effect.verification === null &&
    effect.recovery_action !== 'verify_effect'
  let status = 'No effect confirmed'
  if (planned) {
    status = 'Planned effect · not queued'
  } else if (effect.certainty === 'confirmed') {
    status = 'Historical effect confirmed'
  } else if (effect.certainty === 'unknown') {
    status = 'Effect is unknown; no create retry is allowed'
  }
  return (
    <Field>
      <strong>{effect.label}</strong>
      <Paragraph>{status}</Paragraph>
      {effect.remote_pks.length > 0 && (
        <Small>Attributed IDs: {effect.remote_pks.join(', ')}</Small>
      )}
      {effect.verification && (
        <Small>Latest inspection: {effect.verification.replaceAll('_', ' ')}</Small>
      )}
      {!planned && effect.recovery_action && (
        <Button disabled={busy} onClick={recover}>
          {effect.recovery_action === 'verify_effect'
            ? 'Inspect known original effect'
            : 'Resume selected original effect'}
          : {effect.label}
        </Button>
      )}
      <Small>Original run and approval only. New effects require fresh review.</Small>
    </Field>
  )
}
