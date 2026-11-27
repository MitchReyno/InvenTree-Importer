import { useState } from 'react'
import styled from 'styled-components'
import type { MatchQuestionDto } from '@invimport/contracts'
import { Button, Link, QuestionCard } from '#/components/ui'
import { batchHref } from '#/navigation/batch-route'
import { batchTarget } from '#/processing/match-question'
import { space, typeVar } from '#/theme/generated/tokens'

type Props = {
  batchId: string
  /** Open questions whose first option adds stock to an exact Part, at least two. */
  questions: MatchQuestionDto[]
  lotLabel: (lotId: string) => string
  /** Why the answer can't be sent now, such as a read still landing. */
  unavailableReason?: string
  busy: boolean
  addStockToEach: () => void
}

/**
 * Several exact matches asked once: add stock to each lot's exact Part, all or none, or decide
 * each through its own question.
 */
export function MatchBatchAnswer({
  batchId,
  questions,
  lotLabel,
  unavailableReason,
  busy,
  addStockToEach,
}: Props) {
  const [each, setEach] = useState(false)

  return (
    <section aria-label="Several exact matches">
      <QuestionCard
        question={`${questions.length} lots match existing Parts exactly`}
        why="Each has one exact Part candidate. Adding stock to each runs no research and takes stock photos only."
        answer={
          <>
            {/* Every lot the answer rebinds is named with its Part, however many there are. */}
            <Lots>
              {questions.map((question) => (
                <li key={question.id}>
                  {lotLabel(question.lot_id)} → {batchTarget(question)}
                </li>
              ))}
            </Lots>
            <Actions>
              <Button
                variant="primary"
                busy={busy}
                disabledReason={unavailableReason}
                reasonDisplay="quiet"
                onClick={addStockToEach}
              >
                Add stock to each (photos only)
              </Button>
              <Button aria-expanded={each} onClick={() => setEach((shown) => !shown)}>
                Decide each
              </Button>
            </Actions>
            {each && (
              <Lots aria-label="Each question">
                {questions.map((question) => (
                  <li key={question.id}>
                    <Link
                      href={batchHref(batchId, {
                        tab: 'processing',
                        step: 'match',
                        questionId: question.id,
                      })}
                    >
                      {lotLabel(question.lot_id)}: {question.title}
                    </Link>
                  </li>
                ))}
              </Lots>
            )}
          </>
        }
      />
    </section>
  )
}

const Lots = styled.ul`
  display: grid;
  gap: ${space[2]};
  margin: 0;
  padding-left: ${space[8]};
  font-size: ${typeVar.small.size};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`
