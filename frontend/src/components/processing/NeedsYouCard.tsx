import type { BatchAttentionDto } from '@invimport/contracts'
import styled from 'styled-components'
import { batchHref } from '#/navigation/batch-route'
import type { ProcessingSource } from '#/processing/source'
import { space } from '#/theme/generated/tokens'
import { NeedsYou } from '#/components/ui'
import { NeedsYouList } from '#/components/batches/NeedsYouList'
import { Muted, STEP_LABEL } from './ProcessingParts'

/**
 * Everything the batch header counts, from the same attention read and list. Without that read,
 * only the agent questions this read holds show, and nothing claims the list is empty; a failed
 * read says the list is partial.
 */
export function NeedsYouCard({
  batchId,
  attention,
  unavailable,
  source,
}: {
  batchId: string
  attention?: BatchAttentionDto
  unavailable: boolean
  source: ProcessingSource
}) {
  if (attention) {
    return (
      <Inset>
        <NeedsYouList attention={attention} />
      </Inset>
    )
  }
  const partial = unavailable && (
    <Muted role="status">
      Needs you is unavailable, so Review and Changes items are not listed.
      {source.questions.length > 0 && ' Agent questions are shown.'}
    </Muted>
  )
  if (source.questions.length === 0) {
    return partial || <Muted>Updating…</Muted>
  }

  // The Processing read's own agent questions, oldest first.
  return (
    <>
      {partial}
      <NeedsYou
        items={source.questions.map((question) => ({
          id: question.id,
          step: STEP_LABEL[question.step],
          title: question.title,
          kind: question.kind,
          assumption: [question.subject, question.assumption].filter(Boolean).join(' · '),
          href: batchHref(batchId, {
            tab: 'processing',
            step: question.step,
            questionId: question.id,
          }),
        }))}
      />
    </>
  )
}

/** The shared list's sections carry the popover's inset; in a card they sit on its padding. */
const Inset = styled.div`
  display: grid;
  margin: 0 calc(-1 * ${space[6]});
`
