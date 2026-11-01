import styled from 'styled-components'
import type { ProcessingProposalDto } from '@invimport/contracts'

/** Source identities come from the verified retained attempt, not the current capture selection. */
export function ProcessingSources({ proposal }: { proposal: ProcessingProposalDto }) {
  if ('source_note_ids' in proposal) {
    return (
      <Sources aria-label="Retained candidate sources">
        {proposal.source_note_ids.map((id) => (
          <li key={id}>
            Retained note <code>{id}</code>
          </li>
        ))}
      </Sources>
    )
  }

  return (
    <Sources aria-label="Retained candidate sources">
      {proposal.sources.map((source) =>
        source.kind === 'note' ? (
          <li key={`note:${source.note_id}`}>
            Retained note <code>{source.note_id}</code>
          </li>
        ) : (
          <li key={`media:${source.version_id}`}>
            Retained media version <code>{source.version_id}</code> · evidence{' '}
            <code>{source.evidence_id}</code>
          </li>
        ),
      )}
    </Sources>
  )
}

const Sources = styled.ul`
  margin: 8px 0;
  padding-left: 18px;
  color: #526179;
  font-size: 12px;
  overflow-wrap: anywhere;
`
