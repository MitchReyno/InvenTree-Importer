import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import type { ProcessingProposalDto } from '@invimport/contracts'
import { DebugDetails } from '#/components/ui'

type SourceItem = { key: string; text: string; id: string; evidenceId?: string }

/** Each retained source as one line; older proposals only carry note IDs. */
function sourceItems(proposal: ProcessingProposalDto): SourceItem[] {
  if ('source_note_ids' in proposal) {
    return proposal.source_note_ids.map((id) => ({ key: id, text: 'Retained note', id }))
  }

  return proposal.sources.map((source) => {
    if (source.kind === 'note') {
      return { key: `note:${source.note_id}`, text: 'Retained note', id: source.note_id }
    }
    if (source.kind === 'media_version') {
      return {
        key: `media:${source.version_id}`,
        text: 'Retained media version',
        id: source.version_id,
        evidenceId: source.evidence_id,
      }
    }

    return {
      key: `research:${source.receipt_id}`,
      text: 'Retained research receipt',
      id: source.receipt_id,
    }
  })
}

/**
 * Source identities come from the verified retained attempt, not the current capture selection.
 * They are internal IDs, so they show only in debug mode.
 */
export function ProcessingSources({ proposal }: { proposal: ProcessingProposalDto }) {
  return (
    <DebugDetails label="Candidate sources">
      <Sources aria-label="Retained candidate sources">
        {sourceItems(proposal).map((item) => (
          <li key={item.key}>
            {item.text} <code>{item.id}</code>
            {item.evidenceId && (
              <>
                {' '}
                · evidence <code>{item.evidenceId}</code>
              </>
            )}
          </li>
        ))}
      </Sources>
    </DebugDetails>
  )
}

const Sources = styled.ul`
  margin: 0;
  padding-left: ${space[9]};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
  overflow-wrap: anywhere;
`
