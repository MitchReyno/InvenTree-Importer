import { HeadingRow } from '../ui/primitives'
import { Button, Link, PageTitle, Paragraph, Small } from '../ui/primitives'
import type { CaptureWorkspaceProps } from '../../capture/types'
import styled from 'styled-components'
import type { ManualStage } from '../../manual/types'

type Props = Pick<CaptureWorkspaceProps, 'batch' | 'busy' | 'edit' | 'onStage'> & {
  dirty: boolean
  stage?: ManualStage
}

export function CaptureHeader({ batch, busy, dirty, edit, onStage, stage = 'capture' }: Props) {
  return (
    <BatchHeader>
      <Breadcrumb>
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
        <span aria-hidden="true">/</span>
        <span>{batch.title}</span>
        <SavedState>{busy ? 'Saving / reading…' : `Saved · revision ${batch.revision}`}</SavedState>
      </Breadcrumb>
      <HeadingRow>
        <div>
          <PageTitle>{batch.title}</PageTitle>
          <BatchCounts>
            {batch.lots.length} physical lots · {batch.parts.length} shared Part proposals ·{' '}
            {batch.notes.length} human notes
          </BatchCounts>
        </div>
        <Button
          disabled={busy || dirty}
          onClick={() => void edit({ kind: 'batch', archived: !batch.archived })}
        >
          {batch.archived ? 'Resume archived batch' : 'Archive batch'}
        </Button>
      </HeadingRow>
      <StageNav aria-label="Batch stages">
        {(['capture', 'processing', 'review', 'approve', 'results'] as const).map((value) =>
          value === 'processing' || (!onStage && value !== 'capture') ? (
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
              onClick={() => onStage?.(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </StageControl>
          ),
        )}
      </StageNav>
    </BatchHeader>
  )
}

const BatchHeader = styled.header`
  background: white;
  border: 1px solid #d5dce5;
  border-radius: 6px;
  padding: 0 16px;
  margin-bottom: 12px;
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
const Breadcrumb = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 0;
  border-bottom: 1px solid #e0e5ed;
  font-size: 13px;
  overflow-wrap: anywhere;
`
const SavedState = styled.span`
  margin-left: auto;
  color: #526179;
  @media (max-width: 700px) {
    margin-left: 0;
  }
`
const BatchCounts = styled(Paragraph)`
  margin: 8px 0 12px;
  font-size: 13px;
  color: #526179;
`
const StageNav = styled.nav`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
  padding: 0;
  text-align: center;
  font-size: 13px;
  color: #526179;
  > * {
    padding: 12px 4px;
    border-bottom: 3px solid transparent;
    min-width: 0;
  }
  strong {
    color: #164a93;
    border-color: #266ac5;
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
  min-height: 58px;
  font: inherit;
  color: ${(p) => (p.$active ? '#164a93' : '#526179')};
  font-weight: ${(p) => (p.$active ? 700 : 400)};
  border-bottom: 3px solid ${(p) => (p.$active ? '#266ac5' : 'transparent')};
  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`
