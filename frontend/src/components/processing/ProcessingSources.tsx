import styled from 'styled-components'
import { color, space, typeVar } from '#/theme/generated/tokens'
import type { ProcessingProposalDto, WebPageSourceDto } from '@invimport/contracts'
import { DebugDetails, SourceChip } from '#/components/ui'
import { WebPageLink } from './WebPageLink'

type SourceItem = { key: string; text: string; id: string; evidenceId?: string }

type ProposalSource = Extract<ProcessingProposalDto, { sources: unknown }>['sources'][number]

/** Each retained source as one line; older proposals only carry note IDs. */
function sourceItems(proposal: ProcessingProposalDto): SourceItem[] {
  if ('source_note_ids' in proposal) {
    return proposal.source_note_ids.map((id) => ({ key: id, text: 'Retained note', id }))
  }

  const sources: readonly ProposalSource[] = proposal.sources
  return sources.flatMap((source): SourceItem[] => {
    if (source.kind === 'web_page') {
      return []
    }
    if (source.kind === 'note') {
      return [{ key: `note:${source.note_id}`, text: 'Retained note', id: source.note_id }]
    }
    if (source.kind === 'media_version') {
      return [
        {
          key: `media:${source.version_id}`,
          text: 'Retained media version',
          id: source.version_id,
          evidenceId: source.evidence_id,
        },
      ]
    }

    return [
      {
        key: `research:${source.receipt_id}`,
        text: 'Retained research receipt',
        id: source.receipt_id,
      },
    ]
  })
}

/** The pages a `/6` proposal says the agent read; the app holds no copy of any of them. */
function webPages(proposal: ProcessingProposalDto): WebPageSourceDto[] {
  if (!('sources' in proposal)) {
    return []
  }
  const sources: readonly ProposalSource[] = proposal.sources
  return sources.filter((source): source is WebPageSourceDto => source.kind === 'web_page')
}

/**
 * Source identities come from the verified retained attempt, not the current capture selection.
 * They are internal IDs, so they show only in debug mode. Web pages the agent reports reading
 * are not evidence the app holds, so each shows as a "Web page" chip marked agent-reported.
 */
export function ProcessingSources({ proposal }: { proposal: ProcessingProposalDto }) {
  const pages = webPages(proposal)
  const items = sourceItems(proposal)

  return (
    <>
      {pages.length > 0 && (
        <WebPages aria-label="Web pages the agent reported">
          {pages.map((page, index) => (
            <li key={`${index}:${page.url}`}>
              <SourceChip
                source="Web page"
                certainty="Agent-reported"
                tone="likely"
                why="The agent says it read this page. No copy is saved, so it is not verified."
                evidence={<WebPageLink page={page} />}
              />
            </li>
          ))}
        </WebPages>
      )}
      {items.length > 0 && (
        <DebugDetails label="Candidate sources">
          <Sources aria-label="Retained candidate sources">
            {items.map((item) => (
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
      )}
    </>
  )
}

const WebPages = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  margin: 0;
  padding: 0;
  list-style: none;
`

const Sources = styled.ul`
  margin: 0;
  padding-left: ${space[9]};
  color: ${color.muted};
  font-size: ${typeVar.small.size};
  overflow-wrap: anywhere;
`
