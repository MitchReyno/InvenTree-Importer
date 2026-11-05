import { HeadingRow } from '../ui/primitives'
import { Button, Link, PageTitle, Paragraph, Small } from '../ui/primitives'
import type { CaptureWorkspaceProps } from '../../capture/types'
import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type { ManualStage } from '../../manual/types'

type Props = Pick<CaptureWorkspaceProps, 'batch' | 'busy' | 'edit' | 'onStage' | 'onProcessing'> & {
  dirty: boolean
  stage?: ManualStage | 'processing'
  /** Retired lots stay in the capture snapshot as history; counts show active lots. */
  retiredLotIds?: ReadonlySet<string>
}

export function CaptureHeader({
  batch,
  busy,
  dirty,
  edit,
  onStage,
  onProcessing,
  stage = 'capture',
  retiredLotIds,
}: Props) {
  const retiredCount = batch.lots.filter((lot) => retiredLotIds?.has(lot.id)).length
  const activeCount = batch.lots.length - retiredCount

  function chooseStage(value: ManualStage | 'processing') {
    if (value === 'processing') {
      onProcessing?.()
      return
    }
    onStage?.(value)
  }

  return (
    <BatchHeader>
      <Breadcrumb data-area="breadcrumb">
        <Link
          href="#"
          aria-disabled={dirty}
          onClick={(e) => {
            if (dirty) {
              e.preventDefault()
            }
          }}
        >
          Batches{dirty ? ' (save or discard first)' : ''}
        </Link>
        <SavedState>{busy ? 'Saving / reading…' : `Saved · revision ${batch.revision}`}</SavedState>
      </Breadcrumb>
      <BatchTitleRow data-area="batch-title">
        <div>
          <PageTitle>{batch.title}</PageTitle>
          <BatchCounts>
            {activeCount} physical lots
            {retiredCount > 0 && ` (${retiredCount} retired)`} · {batch.parts.length} shared Part
            proposals · {batch.notes.length} human notes
          </BatchCounts>
        </div>
        <Button
          disabled={busy || dirty}
          onClick={() => void edit({ kind: 'batch', archived: !batch.archived })}
        >
          {batch.archived ? 'Resume archived batch' : 'Archive batch'}
        </Button>
      </BatchTitleRow>
      <StageNav aria-label="Batch stages">
        {(['capture', 'processing', 'review', 'approve', 'results'] as const).map((value) => {
          const unavailable =
            value === 'processing' ? !onProcessing : !onStage && value !== 'capture'
          return unavailable ? (
            <span key={value} aria-disabled="true">
              {value[0].toUpperCase() + value.slice(1)}
              <Small>Not available yet</Small>
            </span>
          ) : (
            <StageControl
              key={value}
              $active={stage === value}
              aria-current={stage === value ? 'page' : undefined}
              disabled={dirty || busy}
              onClick={() => chooseStage(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </StageControl>
          )
        })}
      </StageNav>
    </BatchHeader>
  )
}

const BatchHeader = styled.header`
  background: ${color.surface};
  border: 1px solid ${color.line};
  border-radius: 6px;
  padding: 0 12px;
  margin-bottom: 10px;
  @media (min-width: 1100px) {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(430px, 0.9fr);
    column-gap: 20px;
    [data-area='breadcrumb'] {
      grid-column: 1 / -1;
    }
    [data-area='batch-title'] {
      grid-column: 1;
    }
    > nav {
      grid-column: 2;
      align-self: end;
    }
  }
  @media (max-width: 700px) {
    padding: 0 10px;
    ${HeadingRow} {
      gap: 0;
    }
    ${HeadingRow} > button {
      margin-bottom: 8px;
    }
  }
`
const BatchTitleRow = styled(HeadingRow)`
  padding-top: 4px;
  ${PageTitle} {
    font-size: clamp(20px, 2.4vw, 26px);
    margin: 4px 0;
  }
  > div {
    min-width: 0;
  }
  @media (max-width: 700px) {
    flex-wrap: nowrap;
    align-items: flex-start;
    > button {
      flex-shrink: 0;
      font-size: 12px;
      padding: 6px 8px;
    }
  }
`
const Breadcrumb = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding: 3px 0;
  border-bottom: 1px solid ${color.line};
  font-size: 13px;
  overflow-wrap: anywhere;
`
const SavedState = styled.span`
  margin-left: auto;
  color: ${color.muted};
  @media (max-width: 700px) {
    margin-left: 0;
  }
`
const BatchCounts = styled(Paragraph)`
  margin: 0 0 6px;
  font-size: 13px;
  color: ${color.muted};
`
const StageNav = styled.nav`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
  padding: 0;
  text-align: center;
  font-size: 13px;
  color: ${color.muted};
  > * {
    padding: 8px 4px;
    border-bottom: 3px solid transparent;
    min-width: 0;
  }
  strong {
    color: ${color.accent};
    border-color: ${color.accent};
    align-content: center;
  }
  small {
    font-size: 10px;
  }
  @media (max-width: 700px) {
    font-size: 11px;
    small {
      font-size: 9px;
    }
  }
`
const StageControl = styled.button<{ $active: boolean }>`
  background: transparent;
  border: 0;
  cursor: pointer;
  min-height: 44px;
  font: inherit;
  color: ${(p) => (p.$active ? color.accent : color.muted)};
  font-weight: ${(p) => (p.$active ? 700 : 400)};
  border-bottom: 3px solid ${(p) => (p.$active ? color.accent : 'transparent')};
  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`
