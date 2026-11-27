import styled from 'styled-components'
import type { MatchQuestionDto } from '@invimport/contracts'
import { Link } from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'
import { contributionWords } from '#/processing/match-view'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { MatchCandidate } from './MatchCandidate'

const NOTE_STAGE = { examine: 'Examine', research: 'Research' } as const

type Props = {
  question: MatchQuestionDto
  /** The lot the question asks about, and where the identity Match searched with came from. */
  lot: string
  source?: string
}

/**
 * What a match question quotes: the lot, each candidate, the agents' notes about existing records
 * and an earlier approval of the lot's contribution, linked only when the operator may read it.
 */
export function MatchQuestionDetails({ question, lot, source }: Props) {
  const { contribution } = question

  return (
    <Details>
      <Muted>{[lot, source].filter(Boolean).join(' · ')}</Muted>
      {question.candidates.length > 0 && (
        <Candidates aria-label="Candidates">
          {question.candidates.map((candidate) => (
            <MatchCandidate
              key={candidate.kind === 'part' ? `part:${candidate.part.pk}` : candidate.lot_id}
              candidate={candidate}
            />
          ))}
        </Candidates>
      )}
      {question.notes.map((note, index) => (
        <Note key={index}>
          <b>{NOTE_STAGE[note.stage]}:</b> “{note.text}”
        </Note>
      ))}
      {contribution && (
        <Note>
          {contributionWords(contribution)}{' '}
          {contribution.readable && (
            <Link
              href={batchHref(contribution.batch_id, {
                tab: 'changes',
                view: 'added',
                runId: contribution.run_id,
              })}
            >
              Open the earlier run in Changes › Added
            </Link>
          )}
        </Note>
      )}
    </Details>
  )
}

const Details = styled.div`
  display: grid;
  gap: ${space[4]};
`

const Candidates = styled.ul`
  display: grid;
  gap: ${space[3]};
  margin: 0;
  padding: 0;
  list-style: none;
`

const Note = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
`

const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
