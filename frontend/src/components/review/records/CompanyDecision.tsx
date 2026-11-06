import styled from 'styled-components'
import { color, radius, space } from '../../../theme/generated/tokens'
import { Button } from '../../ui/Button'
import { Pill } from '../../ui/Pill'
import { Small } from '../../ui/primitives'

type Props = {
  role: 'manufacturer' | 'supplier'
  proposed: { name: string; reason: string }
  likely: { label: string; reason: string } | null
  scope: string
  onUseLikely: () => void
  disabled?: boolean
}

/**
 * A proposed new company: use the likely existing match, or pick another. Creating one is not
 * supported, and each choice states what changes.
 */
export function CompanyDecision({
  role,
  proposed,
  likely,
  scope,
  onUseLikely,
  disabled = false,
}: Props) {
  return (
    <Card aria-label={proposed.name}>
      <Head>
        <strong>{proposed.name}</strong>
        <Pill tone="warn">Needs a decision</Pill>
      </Head>
      <Small>Proposed because: {proposed.reason}</Small>
      {likely && (
        <Option>
          <Button size="sm" disabled={disabled} onClick={onUseLikely}>
            Use {likely.label}
          </Button>
          <Small>{likely.reason}</Small>
        </Option>
      )}
      <Small>Or pick another observed {role} below.</Small>
      <Small>Creating a new {role} is not supported yet.</Small>
      <Small>{scope}</Small>
    </Card>
  )
}

const Card = styled.section`
  display: grid;
  gap: ${space[2]};
  padding: ${space[3]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
`
const Head = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[2]};
`
const Option = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`
