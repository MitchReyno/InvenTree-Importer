import { useId, type ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { DisabledFeature, type DisabledControlProps } from './DisabledFeature'
import { media } from './media'
import { Small } from './primitives'

type Common = {
  label: string
  /** One sentence under the label; leave it out when the label says enough. */
  help?: ReactNode
}

type Available = Common & { disabledReason?: undefined; children: ReactNode }

/** A deferred setting: the control renders disabled through `DisabledFeature`. */
type Deferred = Common & {
  disabledReason: string
  children: (control: DisabledControlProps) => ReactNode
}

export type SettingRowProps = Available | Deferred

/** One setting: label and help on the left, its control on the right. Rows stack in a card. */
export function SettingRow(props: SettingRowProps) {
  const id = useId()
  const helpId = props.help ? `${id}-help` : undefined

  return (
    <Row role="group" aria-labelledby={`${id}-label`} aria-describedby={helpId}>
      <Text>
        <Label id={`${id}-label`}>{props.label}</Label>
        {props.help && <Small id={helpId}>{props.help}</Small>}
      </Text>
      <div>
        {props.disabledReason === undefined ? (
          props.children
        ) : (
          <DisabledFeature explanation={props.disabledReason}>{props.children}</DisabledFeature>
        )}
      </div>
    </Row>
  )
}

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
  gap: ${space[4]} ${space[12]};
  padding: ${space[8]};
  border-top: 1px solid ${color.line};
  &:first-child {
    border-top: 0;
  }
  ${media.compact} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Text = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: ${color.fg};
  small {
    color: ${color.muted};
  }
`

const Label = styled.b`
  /* literal-allowed: a setting's label sits between body and h3, as in the design system */
  font-size: 13.5px;
  font-weight: ${typeVar.bodyStrong.weight};
`
