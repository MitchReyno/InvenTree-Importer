import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, space, type } from '#/theme/generated/tokens'
import { Button } from './Button'
import { Pill, type PillTone } from './Pill'
import { Small } from './primitives'
import type { SourceTone } from './SourceChip'

/** What a source chip's popover can say beyond the source and certainty. */
export type SourceDetails = {
  /** The field the value belongs to, such as "Resistance". */
  field?: string
  value?: string
  /** One sentence on why the certainty is what it is. */
  why?: ReactNode
  /** The crop or page the value came from, and where else it appears. */
  evidence?: ReactNode
  /** Opens the evidence; without it there is no Open evidence action. */
  onOpen?: () => void
  /** Edits the value; without it there is no Edit value action. */
  onEdit?: () => void
}

const CERTAINTY_TONE: Record<SourceTone, { tone: PillTone; glyph: string }> = {
  default: { tone: 'ok', glyph: '✓' },
  likely: { tone: 'warn', glyph: '?' },
  conflict: { tone: 'bad', glyph: '×' },
  user: { tone: 'acc', glyph: '✎' },
}

type Props = SourceDetails & {
  certainty: string
  tone: SourceTone
  /** Closes the popover before an action runs. */
  close: () => void
}

/** The source chip's details: field and value, certainty, why, evidence and its actions. */
export function SourceChipPopover({
  field,
  value,
  why,
  evidence,
  onOpen,
  onEdit,
  certainty,
  tone,
  close,
}: Props) {
  const pill = CERTAINTY_TONE[tone]
  const hasActions = onOpen !== undefined || onEdit !== undefined

  function run(action: () => void) {
    close()
    action()
  }

  return (
    <>
      <Head>
        {field && (
          <Heading>
            {field}
            {value !== undefined && <> · {value}</>}
          </Heading>
        )}
        <span>
          <Pill tone={pill.tone} glyph={pill.glyph}>
            {certainty}
          </Pill>
        </span>
        {why && <Small>{why}</Small>}
      </Head>
      {evidence && <Evidence>{evidence}</Evidence>}
      {hasActions && (
        <Actions>
          {onOpen && (
            <Button size="sm" onClick={() => run(onOpen)}>
              Open evidence
            </Button>
          )}
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={() => run(onEdit)}>
              Edit value
            </Button>
          )}
        </Actions>
      )}
    </>
  )
}

const Head = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[3]};
  padding: ${space[5]} ${space[6]};
`

const Heading = styled.b`
  ${type.bodyStrong}
`

const Evidence = styled.div`
  padding: ${space[5]} ${space[6]};
  border-top: 1px solid ${color.line};
  ${type.small}
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
  padding: ${space[2]} ${space[6]} ${space[5]};
`
