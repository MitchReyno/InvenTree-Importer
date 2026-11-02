import type { SupportedEffectResultDto } from '@invimport/contracts'
import { Button, Field, Paragraph, Small } from '../ui/primitives'

interface Props {
  effect: SupportedEffectResultDto
  busy: boolean
  recover: () => void
}

export function SupportedEffectResult({ effect, busy, recover }: Props) {
  return (
    <Field>
      <strong>{effect.label}</strong>
      <Paragraph>
        {effect.certainty === 'confirmed'
          ? 'Historical effect confirmed'
          : effect.certainty === 'unknown'
            ? 'Effect is unknown; no create retry is allowed'
            : 'No effect confirmed'}
      </Paragraph>
      {effect.remote_pks.length > 0 && (
        <Small>Attributed IDs: {effect.remote_pks.join(', ')}</Small>
      )}
      {effect.verification && (
        <Small>Latest inspection: {effect.verification.replaceAll('_', ' ')}</Small>
      )}
      {effect.recovery_action && (
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
