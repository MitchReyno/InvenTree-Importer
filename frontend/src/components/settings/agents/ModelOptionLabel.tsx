import styled from 'styled-components'
import { Skeleton } from '#/components/ui'
import { color, space, type, typeVar } from '#/theme/generated/tokens'
import { modelOptionText, type ModelOption } from './model-options'
import { PROVIDER_LABEL } from './provider-form'

type Props = {
  option: ModelOption
  /** Drawn in the open menu, or as the picker's chosen value. */
  context: 'menu' | 'value'
  /** A provider card's picker lists one provider, so its value needs no provider name. */
  single: boolean
}

/**
 * One option as the menu draws it: a model by name with its exact ID in mono, a note in its tone,
 * Try again as a link. As the chosen value a model reads by name, after its provider in a step.
 */
export function ModelOptionLabel({ option, context, single }: Props) {
  if (option.kind === 'model' && context === 'value') {
    return <>{single ? option.name : `${PROVIDER_LABEL[option.provider]} · ${option.name}`}</>
  }
  switch (option.kind) {
    case 'model':
      return (
        <Row>
          <span>{option.name}</span>
          {option.name !== option.model && (
            <>
              {' '}
              <Id>{option.model}</Id>
            </>
          )}
          {option.unusable && (
            <>
              {' '}
              <Tag>Key can’t use</Tag>
            </>
          )}
        </Row>
      )
    case 'note':
      return (
        <Note $tone={option.tone}>
          {option.tone === 'reading' && (
            <Bars>
              <Skeleton width="40%" height={space[3]} />
              <Skeleton width="52%" height={space[3]} />
              <Skeleton width="36%" height={space[3]} />
            </Bars>
          )}
          {option.text}
        </Note>
      )
    case 'retry':
      return <Action>Try again</Action>
    case 'older':
      return <Toggle>{modelOptionText(option)}</Toggle>
    case 'default':
    case 'exact':
    case 'invalid':
      return <>{modelOptionText(option)}</>
  }
}

const Row = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space[1]} ${space[3]};
`

const Id = styled.code`
  ${type.mono}
  color: ${color.muted};
`

const Tag = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.warn};
`

const Note = styled.span<{ $tone: 'warn' | 'quiet' | 'reading' }>`
  display: block;
  font-size: ${typeVar.small.size};
  color: ${({ $tone }) => ($tone === 'warn' ? color.fg : color.muted)};
  ${({ $tone }) =>
    $tone === 'warn' ? `background: ${color.warnWeak}; padding: ${space[2]} ${space[3]};` : ''}
  &::before {
    content: ${({ $tone }) => ($tone === 'warn' ? "'! '" : 'none')};
    font-weight: ${typeVar.label.weight};
    color: ${color.warn};
  }
`

const Bars = styled.span`
  display: grid;
  gap: ${space[2]};
  margin-bottom: ${space[3]};
`

const Action = styled.span`
  color: ${color.accent};
  font-size: ${typeVar.small.size};
`

const Toggle = styled.span`
  color: ${color.accent};
`
